// ═══════════════════════════════════════════════════════════════════════════
//  treasury-stack.ts — the eight-part treasury-management stack behind the
//  Managed Treasury subscription. Each capability is a skill that reads a shared
//  TreasuryContext and returns findings; the Coordinator runs them in dependency
//  order and keeps dependent actions safe.
//
//  On-chain data (idle USDC, vault position, reserve, APY, observed movements)
//  is assembled live. External feeds — accounts, AP/AR schedule, ledger, FX,
//  payment requests — arrive via connectors on the context; until a connector is
//  wired, those skills report honestly that their inputs aren't connected yet.
// ═══════════════════════════════════════════════════════════════════════════

import { client, ADDR } from "../config.js";

const MCP_BASE = process.env.MCP_BASE || "https://mcp.arcis.money";
const USDC_ABI = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const VAULT_ABI = [
  { name: "reserveBalance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export type Severity = "info" | "watch" | "action" | "risk";
export interface Finding { skill: string; severity: Severity; title: string; detail: string; recommendation?: string; evidence?: string; }

// external feed shapes (a connector populates these; empty by default)
export interface Account { name: string; kind: "onchain" | "bank" | "custodial"; stablecoin: string; balanceUsd: number; yieldApy?: number; }
export interface CashItem { date: string; kind: "inflow" | "outflow"; amountUsd: number; driver: string; status: "scheduled" | "expected" | "actual"; }
export interface LedgerEntry { ref: string; date: string; amountUsd: number; classified?: string; }
export interface PaymentRequest { id: string; toEntity: string; amountUsd: number; fundingSource: string; approved?: boolean; }
export interface FxPosition { currency: string; amount: number; usdRate: number; }

export interface TreasuryContext {
  agent: string;
  idleUsdc: number;
  positionValueUsd: number;
  netDepositedUsd: number;
  earnedUsd: number;
  reserveRatio: number;
  vaultApy: number;
  accounts: Account[];
  cashItems: CashItem[];
  ledger: LedgerEntry[];
  onchainTxs: LedgerEntry[];
  payments: PaymentRequest[];
  fx: FxPosition[];
  authorizedEntities: string[];
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// ── assemble the live context (external feeds default empty) ──
export async function gatherContext(agent: string, external: Partial<TreasuryContext> = {}): Promise<TreasuryContext> {
  let idleUsdc = 0, positionValueUsd = 0, netDepositedUsd = 0, earnedUsd = 0, reserveRatio = 1, vaultApy = 0;
  try {
    const b = (await client.readContract({ address: ADDR.usdc, abi: USDC_ABI, functionName: "balanceOf", args: [agent as `0x${string}`] })) as bigint;
    idleUsdc = Number(b) / 1e6;
  } catch {}
  try {
    const p: any = await (await fetch(`${MCP_BASE}/api/position?address=${agent}`)).json();
    positionValueUsd = Number(p.liveValue ?? p.value ?? 0) / 1e6;
    netDepositedUsd = Number(p.netDeposited ?? 0) / 1e6;
    earnedUsd = Number(p.earned ?? 0) / 1e6;
  } catch {}
  try {
    const v: any = await (await fetch(`${MCP_BASE}/api/vault`)).json();
    vaultApy = Number(v.apy ?? 0);
    if (v.reserveBalance != null && v.totalAssets != null && Number(v.totalAssets) > 0) reserveRatio = Number(v.reserveBalance) / Number(v.totalAssets);
  } catch {}

  const accounts: Account[] = external.accounts ?? [];
  // the Arcis on-chain accounts are always visible
  const onchainAccounts: Account[] = [
    { name: "Idle USDC (wallet)", kind: "onchain", stablecoin: "USDC", balanceUsd: idleUsdc, yieldApy: 0 },
    { name: "Arcis Vault (raUSDC)", kind: "onchain", stablecoin: "USDC", balanceUsd: positionValueUsd, yieldApy: vaultApy },
  ];

  return {
    agent, idleUsdc, positionValueUsd, netDepositedUsd, earnedUsd, reserveRatio, vaultApy,
    accounts: [...onchainAccounts, ...accounts],
    cashItems: external.cashItems ?? [],
    ledger: external.ledger ?? [],
    onchainTxs: external.onchainTxs ?? [],
    payments: external.payments ?? [],
    fx: external.fx ?? [],
    authorizedEntities: external.authorizedEntities ?? [],
  };
}

interface TreasurySkill { name: string; assess(ctx: TreasuryContext): Finding[]; }

// 1 ── Stablecoin visibility
const Visibility: TreasurySkill = {
  name: "Stablecoin Visibility",
  assess(ctx) {
    const usable = ctx.accounts.reduce((a, x) => a + x.balanceUsd, 0);
    const lines = ctx.accounts.filter((a) => a.balanceUsd > 0).map((a) => `${a.name}: ${usd(a.balanceUsd)}${a.yieldApy ? ` @ ${a.yieldApy}%` : ""}`);
    const f: Finding[] = [{
      skill: this.name, severity: "info",
      title: `Usable stablecoins: ${usd(usable)} across ${ctx.accounts.filter((a) => a.balanceUsd > 0).length} account(s)`,
      detail: lines.join(" · ") || "No stablecoin balances visible.",
    }];
    const moved = ctx.onchainTxs.slice(-3);
    if (moved.length) f.push({ skill: this.name, severity: "watch", title: "Recent movement", detail: moved.map((t) => `${t.date}: ${usd(t.amountUsd)} (${t.ref})`).join(" · "), evidence: `${ctx.onchainTxs.length} on-chain movements observed` });
    if (ctx.accounts.length <= 2) f.push({ skill: this.name, severity: "info", title: "Off-chain accounts not connected", detail: "Only on-chain balances are visible. Connect bank/custodial accounts for a full liquidity picture." });
    return f;
  },
};

// 2 ── Forecast (13-week rolling + 12-month)
const Forecast: TreasurySkill = {
  name: "Forecast",
  assess(ctx) {
    if (!ctx.cashItems.length) return [{ skill: this.name, severity: "info", title: "Forecast inputs not connected", detail: "Connect AP/AR or a payment schedule to activate the 13-week rolling and 12-month cash view." }];
    const now = Date.now();
    const within = (days: number) => ctx.cashItems.filter((c) => (new Date(c.date).getTime() - now) / 86400000 <= days);
    const net = (items: CashItem[]) => items.reduce((a, c) => a + (c.kind === "inflow" ? c.amountUsd : -c.amountUsd), 0);
    const opening = ctx.idleUsdc + ctx.positionValueUsd;
    const w13 = net(within(91)), y1 = net(within(365));
    const biggest = [...ctx.cashItems].sort((a, b) => b.amountUsd - a.amountUsd)[0];
    return [
      { skill: this.name, severity: w13 < 0 && opening + w13 < 0 ? "risk" : "info", title: `13-week projected net ${usd(w13)}`, detail: `Opening ${usd(opening)} → 13-week close ${usd(opening + w13)}. 12-month net ${usd(y1)}.`, evidence: `${ctx.cashItems.length} cash items` },
      ...(biggest ? [{ skill: this.name, severity: "watch" as Severity, title: "Largest driver", detail: `${biggest.driver}: ${usd(biggest.amountUsd)} (${biggest.kind}, ${biggest.status}) on ${biggest.date}.` }] : []),
    ];
  },
};

// 3 ── Reconciliation
const Reconciliation: TreasurySkill = {
  name: "Reconciliation",
  assess(ctx) {
    if (!ctx.ledger.length && !ctx.onchainTxs.length) return [{ skill: this.name, severity: "info", title: "No records to reconcile", detail: "Connect a ledger and CUSTOS will match on-chain DeFi activity to your records and surface exceptions." }];
    const matched: string[] = []; const exceptions: LedgerEntry[] = [];
    for (const tx of ctx.onchainTxs) {
      const hit = ctx.ledger.find((l) => Math.abs(l.amountUsd - tx.amountUsd) < 0.01 && l.date === tx.date);
      if (hit) matched.push(tx.ref); else exceptions.push(tx);
    }
    const f: Finding[] = [{ skill: this.name, severity: exceptions.length ? "action" : "info", title: `${matched.length} matched · ${exceptions.length} exception(s)`, detail: exceptions.length ? "On-chain movements without a matching record — review before reporting." : "All on-chain activity matched to records." }];
    for (const ex of exceptions.slice(0, 5)) f.push({ skill: this.name, severity: "action", title: `Unmatched: ${usd(ex.amountUsd)}`, detail: `${ex.date} · ${ex.ref}`, recommendation: "Classify or attach a record." });
    return f;
  },
};

// 4 ── Liquidity optimization
const Liquidity: TreasurySkill = {
  name: "Liquidity Optimization",
  assess(ctx) {
    const f: Finding[] = [];
    if (ctx.idleUsdc >= 1) {
      const annual = ctx.idleUsdc * (ctx.vaultApy / 100);
      f.push({ skill: this.name, severity: "action", title: `${usd(ctx.idleUsdc)} idle could be earning`, detail: `Idle USDC earns nothing. Deployed at the current ${ctx.vaultApy}% it would earn ~${usd(annual)}/yr.`, recommendation: `Deposit ${usd(ctx.idleUsdc)} into the vault (keep your liquidity floor liquid).` });
    }
    const trapped = ctx.accounts.filter((a) => a.kind !== "onchain" && (a.yieldApy ?? 0) === 0 && a.balanceUsd > 0);
    for (const t of trapped) f.push({ skill: this.name, severity: "watch", title: `Trapped cash: ${t.name}`, detail: `${usd(t.balanceUsd)} sitting at 0% in ${t.name}.`, recommendation: "Move to a yield venue or on-ramp into the vault." });
    if (!f.length) f.push({ skill: this.name, severity: "info", title: "No idle or trapped cash", detail: "Stablecoins are deployed efficiently." });
    return f;
  },
};

// 5 ── Anomaly & risk
const Anomaly: TreasurySkill = {
  name: "Anomaly & Risk",
  assess(ctx) {
    const f: Finding[] = [];
    if (ctx.netDepositedUsd > 0 && ctx.positionValueUsd < ctx.netDepositedUsd * 0.9) f.push({ skill: this.name, severity: "risk", title: "Position value below capital in", detail: `Value ${usd(ctx.positionValueUsd)} vs net deposited ${usd(ctx.netDepositedUsd)} — a ${(((ctx.netDepositedUsd - ctx.positionValueUsd) / ctx.netDepositedUsd) * 100).toFixed(1)}% shortfall.`, evidence: "on-chain position read" });
    if (ctx.reserveRatio < 0.1) f.push({ skill: this.name, severity: "risk", title: "Thin vault reserve", detail: `Reserve ${(ctx.reserveRatio * 100).toFixed(1)}% — instant-withdrawal liquidity is limited.` });
    const amts = ctx.onchainTxs.map((t) => Math.abs(t.amountUsd));
    if (amts.length >= 4) {
      const mean = amts.reduce((a, b) => a + b, 0) / amts.length;
      const sd = Math.sqrt(amts.reduce((a, b) => a + (b - mean) ** 2, 0) / amts.length) || 1;
      for (const t of ctx.onchainTxs) if (Math.abs(Math.abs(t.amountUsd) - mean) > 3 * sd) f.push({ skill: this.name, severity: "watch", title: `Outlier movement: ${usd(t.amountUsd)}`, detail: `${t.date} · ${t.ref} — far outside the recent norm (~${usd(mean)}).`, evidence: `mean ${usd(mean)}, σ ${usd(sd)}` });
    }
    if (!f.length) f.push({ skill: this.name, severity: "info", title: "No anomalies", detail: "Stablecoin activity is within expected patterns." });
    return f;
  },
};

// 6 ── FX exposure
const FX: TreasurySkill = {
  name: "FX Exposure",
  assess(ctx) {
    if (!ctx.fx.length) return [{ skill: this.name, severity: "info", title: "No non-USD exposure connected", detail: "All visible cash is USD-denominated. Connect non-USD balances/flows to track FX exposure." }];
    const treasury = ctx.idleUsdc + ctx.positionValueUsd;
    const f: Finding[] = [];
    for (const p of ctx.fx) {
      const usdVal = p.amount * p.usdRate;
      const material = treasury > 0 && Math.abs(usdVal) / treasury > 0.1;
      f.push({ skill: this.name, severity: material ? "watch" : "info", title: `${p.currency}: ${usd(usdVal)} exposure`, detail: `${p.amount.toLocaleString()} ${p.currency} @ ${p.usdRate}${material ? " — material (>10% of treasury)" : ""}.`, recommendation: material ? "Assess hedging before it surprises reporting." : undefined });
    }
    return f;
  },
};

// 7 ── Payments (controlled approval + release)
const Payments: TreasurySkill = {
  name: "Payments",
  assess(ctx) {
    if (!ctx.payments.length) return [{ skill: this.name, severity: "info", title: "No payments queued", detail: "Submit payment requests and CUSTOS checks entity, funding, and release rules before anything moves." }];
    const available = ctx.idleUsdc + ctx.positionValueUsd;
    const f: Finding[] = [];
    for (const p of ctx.payments) {
      const authorized = ctx.authorizedEntities.length === 0 || ctx.authorizedEntities.includes(p.toEntity);
      const funded = p.amountUsd <= available;
      const ready = authorized && funded && p.approved;
      const blocks = [!authorized ? "unauthorized entity" : "", !funded ? "insufficient funding" : "", !p.approved ? "awaiting approval" : ""].filter(Boolean);
      f.push({ skill: this.name, severity: ready ? "action" : "watch", title: `${usd(p.amountUsd)} → ${p.toEntity}`, detail: ready ? `Cleared checks (funding: ${p.fundingSource}). Ready for release.` : `Held: ${blocks.join(", ")}.`, recommendation: ready ? "Release on approval." : "Resolve blocks before release." });
    }
    return f;
  },
};

const ORDER: TreasurySkill[] = [Visibility, Forecast, Reconciliation, Liquidity, Anomaly, FX, Payments];

// 8 ── Coordination — runs the stack in order and enforces cross-workflow control gates
export interface TreasuryReview { agent: string; findings: Finding[]; gates: string[]; actions: string[]; }
export async function treasuryReview(agent: string, external: Partial<TreasuryContext> = {}): Promise<TreasuryReview> {
  const ctx = await gatherContext(agent, external);
  const findings: Finding[] = [];
  for (const s of ORDER) { try { findings.push(...s.assess(ctx)); } catch { /* skill isolation */ } }

  // control gates: one workflow must not create a control issue in another
  const gates: string[] = [];
  const hasRisk = findings.some((f) => f.severity === "risk");
  const lowLiquidity = ctx.reserveRatio < 0.1 || findings.some((f) => f.skill === "Liquidity Optimization" && f.severity === "risk");
  const paymentsReady = findings.filter((f) => f.skill === "Payments" && /Ready for release/.test(f.detail));
  if ((hasRisk || lowLiquidity) && paymentsReady.length) gates.push(`Holding ${paymentsReady.length} payment release(s): an open risk/liquidity flag must clear first.`);
  if (findings.some((f) => f.skill === "Reconciliation" && f.severity === "action")) gates.push("Reconciliation exceptions are open — resolve before month-end reporting.");

  const actions = findings.filter((f) => f.severity === "action" && !gates.some((g) => g.includes("payment") && f.skill === "Payments")).map((f) => `${f.skill}: ${f.recommendation || f.title}`);
  return { agent, findings, gates, actions };
}

export function renderReview(r: TreasuryReview): string {
  const bySkill = new Map<string, Finding[]>();
  for (const f of r.findings) { const a = bySkill.get(f.skill) || []; a.push(f); bySkill.set(f.skill, a); }
  const icon: Record<Severity, string> = { info: "·", watch: "▸", action: "◆", risk: "⚠" };
  const L: string[] = [`*Managed Treasury — coordinated review* for \`${r.agent}\``];
  for (const [skill, fs] of bySkill) {
    L.push(`\n*${skill}*`);
    for (const f of fs) L.push(`  ${icon[f.severity]} ${f.title}${f.detail ? ` — ${f.detail}` : ""}${f.recommendation ? `  → ${f.recommendation}` : ""}`);
  }
  if (r.gates.length) { L.push(`\n*Coordination — control gates*`); for (const g of r.gates) L.push(`  ⚠ ${g}`); }
  if (r.actions.length) { L.push(`\n*Ready actions*`); for (const a of r.actions) L.push(`  ◆ ${a}`); }
  return L.join("\n");
}
