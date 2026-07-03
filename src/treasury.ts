// ═══════════════════════════════════════════════════════════════════════════
//  treasury.ts — The Agentic Treasury Engine
//
//  CUSTOS runs a full, transparent treasury lifecycle on its own token:
//
//    1. ACCUMULATE  — buy $CUSTOS from the Virtuals bonding curve with $VIRTUAL.
//                     One-directional (buy-and-hold), disclosed, rate-limited.
//                     Real $VIRTUAL into the curve → genuine progress to the
//                     42,000 $VIRTUAL graduation threshold.
//    2. VAULT       — deposit acquired $CUSTOS into the raCUSTOS vault → shares.
//                     The token becomes productive collateral, not idle bags.
//    3. CREDIT      — the raCUSTOS position underwrites on-chain credit capacity
//                     via AgentCredit (reputation-tiered collateral ratio).
//    4. BONDS/RWA   — that credit collateralizes toward revenue bonds / RWA.
//
//  This is NOT wash trading. Every buy is held (deposited), announced, and
//  on-chain. The only "volume" it creates is real accumulation the treasury
//  keeps. It proves the Agent Treasury Interface end-to-end, on CUSTOS's own
//  token, with CUSTOS as the operator.
//
//  SAFETY: dry-run by default. Live execution requires TREASURY_DRY_RUN=false
//  AND an on-chain preflight that verifies the Virtuals wiring before any spend.
// ═══════════════════════════════════════════════════════════════════════════

import { type Address, parseUnits, formatUnits } from "viem";
import * as fs from "fs";
import { client, getWallet, ADDR, base, EXPLORER } from "./config.js";

// ── Virtuals bonding curve (Base mainnet) ──────────────────────────────────
// $VIRTUAL on Base (verified on-chain: symbol VIRTUAL, 18 decimals).
// NOTE: 0x44ff86… is the ETH-L1 VIRTUAL — do not use it here.
export const VIRTUAL: Address = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";

// Protocol graduation target (standard Virtuals threshold).
export const GRAD_THRESHOLD_VIRTUAL = 42_000;

// The Virtuals `Bonding` singleton on Base. REQUIRED for live execution and
// verified by preflight() — never hardcoded to a guess. Find it as the `to`
// address of any buy tx on the $CUSTOS token page on BaseScan.
export const BONDING: Address = (process.env.VIRTUALS_BONDING_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

export const CUSTOS_TOKEN: Address = ADDR.custosToken;
export const CUSTOS_VAULT: Address = ADDR.custosVault;

// ── ABIs ───────────────────────────────────────────────────────────────────
export const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Virtuals Bonding.sol (authoritative signatures from Virtual-Protocol/protocol-contracts)
export const BONDING_ABI = [
  { name: "buy", type: "function", stateMutability: "payable", inputs: [
    { name: "amountIn", type: "uint256" }, { name: "tokenAddress", type: "address" },
    { name: "amountOutMin", type: "uint256" }, { name: "deadline", type: "uint256" },
  ], outputs: [{ type: "bool" }] },
  { name: "sell", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "amountIn", type: "uint256" }, { name: "tokenAddress", type: "address" },
    { name: "amountOutMin", type: "uint256" }, { name: "deadline", type: "uint256" },
  ], outputs: [{ type: "bool" }] },
  { name: "router", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "factory", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "gradThreshold", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const FROUTER_ABI = [
  { name: "assetToken", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export const FFACTORY_ABI = [
  { name: "getPair", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }] },
] as const;

export const FPAIR_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { name: "assetBalance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// Arcis vault (raCUSTOS) — custom interface, NOT two-arg ERC-4626.
export const VAULT_DEP_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ name: "shares", type: "uint256" }] },
  { name: "previewDeposit", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "asset", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const CREDIT_RATIO_ABI = [
  { name: "getCollateralRatio", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// ── Params (env-driven, safe defaults) ──────────────────────────────────────
const envNum = (k: string, d: number) => { const v = process.env[k]; const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
const envBool = (k: string, d: boolean) => { const v = process.env[k]; if (v == null || v === "") return d; return /^(1|true|yes|on)$/i.test(v); };

export const T = {
  enabled:         envBool("TREASURY_ENABLED", false),      // master switch (off by default)
  dryRun:          envBool("TREASURY_DRY_RUN", true),        // SAFE default — simulate, don't spend
  perBuyVirtual:   envNum("TREASURY_PER_BUY_VIRTUAL", 10),   // $VIRTUAL per accumulation buy
  budgetVirtual:   envNum("TREASURY_BUDGET_VIRTUAL", 100),   // total lifetime $VIRTUAL budget
  dailyCapVirtual: envNum("TREASURY_DAILY_CAP_VIRTUAL", 50), // max $VIRTUAL spent per rolling day
  intervalMs:      envNum("TREASURY_INTERVAL_MS", 3_600_000),// min spacing between buys (1h)
  maxSlippageBps:  envNum("TREASURY_MAX_SLIPPAGE_BPS", 300), // 3% floor on tokens received
  autoDeposit:     envBool("TREASURY_AUTO_DEPOSIT", true),   // deposit acquired $CUSTOS → raCUSTOS
  stopAtGraduation: envBool("TREASURY_STOP_AT_GRADUATION", true),
};

const STATE_PATH = process.env.TREASURY_STATE_PATH || "./.treasury-state.json";
const dl = () => BigInt(Math.floor(Date.now() / 1000) + 300); // 5-min deadline

// ── Persisted state ──────────────────────────────────────────────────────────
export interface TreasuryState {
  day: string;
  dailySpentWei: string;
  spentWei: string;        // lifetime $VIRTUAL spent
  acquiredWei: string;     // lifetime $CUSTOS acquired
  depositedWei: string;    // lifetime $CUSTOS deposited to vault
  sharesWei: string;       // lifetime raCUSTOS shares received
  buys: number;
  lastBuyTs: number;
  graduated: boolean;
}
const zero: TreasuryState = { day: "", dailySpentWei: "0", spentWei: "0", acquiredWei: "0", depositedWei: "0", sharesWei: "0", buys: 0, lastBuyTs: 0, graduated: false };

export function loadState(): TreasuryState {
  try { return { ...zero, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) }; }
  catch { return { ...zero }; }
}
function saveState(s: TreasuryState) { try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {} }
const today = () => new Date().toISOString().slice(0, 10);
function rollDay(s: TreasuryState) { const d = today(); if (s.day !== d) { s.day = d; s.dailySpentWei = "0"; } }

// ── Reads ────────────────────────────────────────────────────────────────────
export async function getPair(): Promise<Address> {
  const factory = await client.readContract({ address: BONDING, abi: BONDING_ABI, functionName: "factory" }) as Address;
  return await client.readContract({ address: factory, abi: FFACTORY_ABI, functionName: "getPair", args: [CUSTOS_TOKEN, VIRTUAL] }) as Address;
}

export interface GradProgress { raisedVirtual: number; target: number; pct: number; graduated: boolean; }
export async function graduationProgress(): Promise<GradProgress> {
  try {
    const pair = await getPair();
    if (!pair || pair === "0x0000000000000000000000000000000000000000")
      return { raisedVirtual: 0, target: GRAD_THRESHOLD_VIRTUAL, pct: 0, graduated: true };
    // assetBalance() = the REAL $VIRTUAL accumulated in the curve pair.
    const assetWei = await client.readContract({ address: pair, abi: FPAIR_ABI, functionName: "assetBalance" }) as bigint;
    const raised = Number(formatUnits(assetWei, 18));
    const pct = Math.min(100, (raised / GRAD_THRESHOLD_VIRTUAL) * 100);
    return { raisedVirtual: raised, target: GRAD_THRESHOLD_VIRTUAL, pct, graduated: false };
  } catch {
    return { raisedVirtual: 0, target: GRAD_THRESHOLD_VIRTUAL, pct: 0, graduated: false };
  }
}

// Reserve-based quote → conservative minOut (the on-chain amountOutMin is the
// real protection; this just derives a sane floor). getReserves() returns
// (reserveToken, reserveAsset) per Bonding._buy.
export async function quote(amountInWei: bigint): Promise<{ expectedOut: bigint; minOut: bigint }> {
  try {
    const pair = await getPair();
    const [rToken, rAsset] = await client.readContract({ address: pair, abi: FPAIR_ABI, functionName: "getReserves" }) as [bigint, bigint];
    const inAfterFee = (amountInWei * 99n) / 100n;          // 1% Virtuals fee
    const expectedOut = (rToken * inAfterFee) / (rAsset + inAfterFee);
    const minOut = (expectedOut * BigInt(10_000 - T.maxSlippageBps)) / 10_000n;
    return { expectedOut, minOut };
  } catch {
    return { expectedOut: 0n, minOut: 0n };
  }
}

export interface Preflight { ok: boolean; reasons: string[]; router?: Address; assetOk: boolean; tradingOk: boolean; walletVirtualWei: bigint; }
export async function preflight(wallet: Address): Promise<Preflight> {
  const reasons: string[] = [];
  let router: Address | undefined; let assetOk = false; let tradingOk = false; let walletVirtualWei = 0n;

  if (BONDING === "0x0000000000000000000000000000000000000000")
    reasons.push("VIRTUALS_BONDING_ADDRESS not set — required for live execution.");

  try {
    router = await client.readContract({ address: BONDING, abi: BONDING_ABI, functionName: "router" }) as Address;
    const asset = await client.readContract({ address: router, abi: FROUTER_ABI, functionName: "assetToken" }) as Address;
    assetOk = asset.toLowerCase() === VIRTUAL.toLowerCase();
    if (!assetOk) reasons.push(`FRouter.assetToken (${asset}) != $VIRTUAL — wrong Bonding address.`);
  } catch (e: any) { reasons.push(`Could not read Bonding.router()/assetToken(): ${e.shortMessage || e.message}`); }

  try {
    const pair = await getPair();
    const bal = await client.readContract({ address: pair, abi: FPAIR_ABI, functionName: "balance" }) as bigint;
    tradingOk = bal > 0n; // curve pair still holds tokens → not yet graduated
    if (!tradingOk) reasons.push("Curve pair holds no $CUSTOS — token appears graduated; accumulation halts.");
  } catch (e: any) { reasons.push(`Could not read curve pair: ${e.shortMessage || e.message}`); }

  try {
    walletVirtualWei = await client.readContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet] }) as bigint;
    if (walletVirtualWei < parseUnits(String(T.perBuyVirtual), 18))
      reasons.push(`Wallet $VIRTUAL (${formatUnits(walletVirtualWei, 18)}) < per-buy size (${T.perBuyVirtual}).`);
  } catch (e: any) { reasons.push(`Could not read wallet $VIRTUAL balance: ${e.shortMessage || e.message}`); }

  return { ok: reasons.length === 0, reasons, router, assetOk, tradingOk, walletVirtualWei };
}

// ── Credit capacity (read-only reporting) ─────────────────────────────────────
export interface CreditView { ratioBps: number; sharesWei: bigint; note: string; }
export async function creditCapacity(wallet: Address): Promise<CreditView> {
  let ratioBps = 0;
  try { ratioBps = Number(await client.readContract({ address: ADDR.credit, abi: CREDIT_RATIO_ABI, functionName: "getCollateralRatio", args: [wallet] })); } catch {}
  let sharesWei = 0n;
  try { sharesWei = await client.readContract({ address: CUSTOS_VAULT, abi: VAULT_DEP_ABI, functionName: "balanceOf", args: [wallet] }) as bigint; } catch {}
  return {
    ratioBps, sharesWei,
    note: "raCUSTOS collateral valuation for AgentCredit must be confirmed before borrow(); v1 reports capacity only.",
  };
}

// ── Result type ───────────────────────────────────────────────────────────────
export interface StepResult {
  action: "buy" | "buy+deposit" | "skip" | "halt";
  dryRun: boolean;
  spentVirtual: number;
  acquiredCustos: number;
  depositedCustos: number;
  sharesReceived: number;
  buyTx?: string;
  depositTx?: string;
  reason?: string;
  progress: GradProgress;
}

// ── One accumulation cycle (all guards + optional deposit) ────────────────────
export async function accumulateStep(): Promise<StepResult> {
  const s = loadState();
  rollDay(s);
  const progress = await graduationProgress();
  const base0: StepResult = { action: "skip", dryRun: T.dryRun, spentVirtual: 0, acquiredCustos: 0, depositedCustos: 0, sharesReceived: 0, progress };

  if (!T.enabled) return { ...base0, reason: "TREASURY_ENABLED=false" };
  if (s.graduated || progress.graduated) { s.graduated = true; saveState(s); return { ...base0, action: "halt", reason: "Token graduated — accumulation complete." }; }

  // rate limit
  if (Date.now() - s.lastBuyTs < T.intervalMs)
    return { ...base0, reason: `cooldown (${Math.ceil((T.intervalMs - (Date.now() - s.lastBuyTs)) / 60000)}m left)` };

  // budget + daily cap
  const spent = Number(formatUnits(BigInt(s.spentWei), 18));
  const dailySpent = Number(formatUnits(BigInt(s.dailySpentWei), 18));
  if (spent >= T.budgetVirtual) return { ...base0, reason: `lifetime budget reached (${spent}/${T.budgetVirtual} VIRTUAL)` };
  const buyVirtual = Math.min(T.perBuyVirtual, T.budgetVirtual - spent, T.dailyCapVirtual - dailySpent);
  if (buyVirtual <= 0) return { ...base0, reason: `daily cap reached (${dailySpent}/${T.dailyCapVirtual} VIRTUAL)` };

  const wallet = getWallet();
  if (!wallet) return { ...base0, reason: "no wallet (CUSTOS_PRIVATE_KEY unset) — monitor mode" };
  const me = wallet.account.address;

  // preflight wiring check (always, even in dry-run — so we surface config errors)
  const pf = await preflight(me);
  const amountInWei = parseUnits(String(buyVirtual), 18);
  const { expectedOut, minOut } = await quote(amountInWei);

  // ── DRY RUN ──
  if (T.dryRun) {
    const note = pf.ok ? "preflight OK" : `preflight: ${pf.reasons[0]}`;
    return {
      ...base0, action: T.autoDeposit ? "buy+deposit" : "buy",
      spentVirtual: buyVirtual,
      acquiredCustos: Number(formatUnits(expectedOut, 18)),
      depositedCustos: T.autoDeposit ? Number(formatUnits(expectedOut, 18)) : 0,
      reason: `DRY RUN — would buy ${buyVirtual} VIRTUAL → ~${Number(formatUnits(expectedOut, 18)).toFixed(2)} CUSTOS (minOut ${Number(formatUnits(minOut, 18)).toFixed(2)}); ${note}`,
    };
  }

  // ── LIVE ── refuse if preflight failed
  if (!pf.ok) return { ...base0, action: "halt", reason: `preflight failed: ${pf.reasons.join("; ")}` };
  if (minOut <= 0n) return { ...base0, action: "halt", reason: "could not derive a safe minOut — refusing to buy blind." };

  // 1) approve VIRTUAL → FRouter (the router pulls funds), then Bonding.buy
  const router = pf.router!;
  const allowance = await client.readContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "allowance", args: [me, router] }) as bigint;
  if (allowance < amountInWei) {
    const aTx = await wallet.writeContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "approve", args: [router, amountInWei], account: wallet.account, chain: base });
    await client.waitForTransactionReceipt({ hash: aTx });
  }
  const custosBefore = await client.readContract({ address: CUSTOS_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const buyTx = await wallet.writeContract({ address: BONDING, abi: BONDING_ABI, functionName: "buy", args: [amountInWei, CUSTOS_TOKEN, minOut, dl()], account: wallet.account, chain: base });
  await client.waitForTransactionReceipt({ hash: buyTx });
  const custosAfter = await client.readContract({ address: CUSTOS_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const acquired = custosAfter - custosBefore;

  // record spend
  s.spentWei = (BigInt(s.spentWei) + amountInWei).toString();
  s.dailySpentWei = (BigInt(s.dailySpentWei) + amountInWei).toString();
  s.acquiredWei = (BigInt(s.acquiredWei) + acquired).toString();
  s.buys += 1; s.lastBuyTs = Date.now();

  const res: StepResult = {
    action: "buy", dryRun: false, spentVirtual: buyVirtual,
    acquiredCustos: Number(formatUnits(acquired, 18)),
    depositedCustos: 0, sharesReceived: 0, buyTx, progress: await graduationProgress(),
  };

  // 2) deposit acquired CUSTOS → raCUSTOS vault
  if (T.autoDeposit && acquired > 0n) {
    try {
      const vAllow = await client.readContract({ address: CUSTOS_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [me, CUSTOS_VAULT] }) as bigint;
      if (vAllow < acquired) {
        const apTx = await wallet.writeContract({ address: CUSTOS_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [CUSTOS_VAULT, acquired], account: wallet.account, chain: base });
        await client.waitForTransactionReceipt({ hash: apTx });
      }
      const sharesBefore = await client.readContract({ address: CUSTOS_VAULT, abi: VAULT_DEP_ABI, functionName: "balanceOf", args: [me] }) as bigint;
      const dTx = await wallet.writeContract({ address: CUSTOS_VAULT, abi: VAULT_DEP_ABI, functionName: "deposit", args: [acquired], account: wallet.account, chain: base });
      await client.waitForTransactionReceipt({ hash: dTx });
      const sharesAfter = await client.readContract({ address: CUSTOS_VAULT, abi: VAULT_DEP_ABI, functionName: "balanceOf", args: [me] }) as bigint;
      const shares = sharesAfter - sharesBefore;
      s.depositedWei = (BigInt(s.depositedWei) + acquired).toString();
      s.sharesWei = (BigInt(s.sharesWei) + shares).toString();
      res.action = "buy+deposit"; res.depositTx = dTx;
      res.depositedCustos = Number(formatUnits(acquired, 18));
      res.sharesReceived = Number(formatUnits(shares, 18));
    } catch (e: any) {
      res.reason = `bought OK, deposit deferred: ${e.shortMessage || e.message}`;
    }
  }

  saveState(s);
  return res;
}

export function txUrl(hash: string) { return `${EXPLORER}/tx/${hash}`; }
