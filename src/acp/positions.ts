// ═══════════════════════════════════════════════════════════════════════════
//  acp/positions.ts — Treasury Management custody ledger
//
//  CUSTOS manages other agents' USDC as a fund-transfer ACP service. Each
//  client's principal is deposited into the raUSDC vault; the vault's shares
//  are the unit of account, so yield accrues automatically via share price and
//  every client's position is exactly attributable. A persisted ledger records
//  who owns which shares; a read-only Resource exposes it for verification.
//
//  Custody model: pooled vault position + per-client share ledger. This is a
//  deliberate choice over "separate hot wallet per client" — shares give exact,
//  auditable per-client attribution with far less key-management surface for a
//  solo operator. The Resource makes every position queryable. (Tradeoff noted
//  in ACP.md.)
//
//  Off + dry-run by default. Live requires the agent wallet in Unrestricted
//  signer mode (the Arcis vault is a non-Virtuals contract).
// ═══════════════════════════════════════════════════════════════════════════

import { type Address, parseUnits, formatUnits } from "viem";
import * as fs from "fs";
import { client, getWallet, ADDR, base } from "../config.js";

const envNum = (k: string, d: number) => { const v = process.env[k]; const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
const envBool = (k: string, d: boolean) => { const v = process.env[k]; if (v == null || v === "") return d; return /^(1|true|yes|on)$/i.test(v); };

export const MGMT = {
  enabled:      envBool("ACP_MGMT_ENABLED", false),
  dryRun:       envBool("ACP_MGMT_DRY_RUN", true),
  maxPerClient: envNum("ACP_MGMT_MAX_PER_CLIENT_USDC", 1000), // per-position principal cap
  maxAum:       envNum("ACP_MGMT_MAX_AUM_USDC", 10000),       // total AUM cap
  reserveUsdc:  envNum("ACP_MGMT_RESERVE_USDC", 0),           // keep liquid, never deploy
};

const USDC = ADDR.usdc;    // 6 dp
const VAULT = ADDR.vault;  // raUSDC (Arcis)
const STATE = process.env.ACP_POSITIONS_PATH || "./.acp-positions.json";

const ERC20 = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const VAULT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "previewDeposit", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "previewWithdraw", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// ── Ledger ───────────────────────────────────────────────────────────────────
export interface Position {
  id: string;
  jobId: string;
  client: string;
  returnAddress: Address;
  principalUsdc: number;
  sharesWei: string;
  openedAt: number;
  status: "open" | "closed";
  openTx?: string;
  closedAt?: number;
  returnedUsdc?: number;
  yieldUsdc?: number;
  closeTx?: string;
}
interface Ledger { seq: number; positions: Position[]; }

function load(): Ledger {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { seq: 0, positions: [] }; }
}
function save(l: Ledger) { try { fs.writeFileSync(STATE, JSON.stringify(l, null, 2)); } catch {} }

export function listPositions(status?: "open" | "closed"): Position[] {
  const l = load();
  return status ? l.positions.filter(p => p.status === status) : l.positions;
}
export function getPosition(id: string): Position | undefined {
  return load().positions.find(p => p.id === id || p.jobId === id);
}

/** AUM overview — current USDC value of all open positions (yield included via share price). */
export async function aum() {
  const open = listPositions("open");
  const principal = open.reduce((a, p) => a + p.principalUsdc, 0);
  let sharesWei = 0n; for (const p of open) sharesWei += BigInt(p.sharesWei);
  let valueUsdc = principal;
  try {
    if (sharesWei > 0n) {
      const v = await client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "previewWithdraw", args: [sharesWei] }) as bigint;
      valueUsdc = Number(formatUnits(v, 6));
    }
  } catch {}
  return { openCount: open.length, principalUsdc: principal, valueUsdc, sharesWei };
}

// ── Open a managed position (fund-transfer job.funded) ────────────────────────
export interface OpenResult { ok: boolean; dryRun: boolean; positionId?: string; sharesReceived?: number; principalUsdc: number; reason?: string; openTx?: string; }

export async function openPosition(p: { jobId: string; client: string; returnAddress: Address; principalUsdc: number }): Promise<OpenResult> {
  const l = load();
  // idempotency — never open twice for the same job
  const existing = l.positions.find(x => x.jobId === p.jobId);
  if (existing) return { ok: true, dryRun: MGMT.dryRun, positionId: existing.id, principalUsdc: existing.principalUsdc, sharesReceived: Number(formatUnits(BigInt(existing.sharesWei), 18)), reason: "already open" };

  if (!MGMT.enabled) return { ok: false, dryRun: MGMT.dryRun, principalUsdc: p.principalUsdc, reason: "ACP_MGMT_ENABLED=false" };
  if (p.principalUsdc <= 0) return { ok: false, dryRun: MGMT.dryRun, principalUsdc: p.principalUsdc, reason: "zero principal" };
  if (p.principalUsdc > MGMT.maxPerClient) return { ok: false, dryRun: MGMT.dryRun, principalUsdc: p.principalUsdc, reason: `exceeds per-client cap (${MGMT.maxPerClient} USDC)` };

  const cur = await aum();
  if (cur.valueUsdc + p.principalUsdc > MGMT.maxAum) return { ok: false, dryRun: MGMT.dryRun, principalUsdc: p.principalUsdc, reason: `would exceed AUM cap (${MGMT.maxAum} USDC)` };

  const wallet = getWallet();
  if (!wallet) return { ok: false, dryRun: MGMT.dryRun, principalUsdc: p.principalUsdc, reason: "no wallet" };
  const me = wallet.account.address;
  const principalWei = parseUnits(p.principalUsdc.toFixed(6), 6);

  // verify the escrowed principal actually landed before deploying it
  const bal = await client.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [me] }) as bigint;
  if (bal < principalWei + parseUnits(MGMT.reserveUsdc.toFixed(6), 6))
    return { ok: false, dryRun: MGMT.dryRun, principalUsdc: p.principalUsdc, reason: `wallet USDC (${Number(formatUnits(bal, 6)).toFixed(2)}) < principal+reserve — awaiting escrow release` };

  if (MGMT.dryRun) {
    let preview = 0n;
    try { preview = await client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "previewDeposit", args: [principalWei] }) as bigint; } catch {}
    return { ok: true, dryRun: true, principalUsdc: p.principalUsdc, sharesReceived: Number(formatUnits(preview, 18)), reason: `DRY RUN — would open position for ${p.principalUsdc} USDC → ~${Number(formatUnits(preview, 18)).toFixed(2)} raUSDC` };
  }

  // live: approve → deposit → record exact shares received
  const allow = await client.readContract({ address: USDC, abi: ERC20, functionName: "allowance", args: [me, VAULT] }) as bigint;
  if (allow < principalWei) {
    const aTx = await wallet.writeContract({ address: USDC, abi: ERC20, functionName: "approve", args: [VAULT, principalWei], account: wallet.account, chain: base });
    await client.waitForTransactionReceipt({ hash: aTx });
  }
  const sharesBefore = await client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const dTx = await wallet.writeContract({ address: VAULT, abi: VAULT_ABI, functionName: "deposit", args: [principalWei], account: wallet.account, chain: base });
  await client.waitForTransactionReceipt({ hash: dTx });
  const sharesAfter = await client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const shares = sharesAfter - sharesBefore;

  const id = `pos_${++l.seq}`;
  l.positions.push({ id, jobId: p.jobId, client: p.client, returnAddress: p.returnAddress, principalUsdc: p.principalUsdc, sharesWei: shares.toString(), openedAt: Date.now(), status: "open", openTx: dTx });
  save(l);
  return { ok: true, dryRun: false, positionId: id, sharesReceived: Number(formatUnits(shares, 18)), principalUsdc: p.principalUsdc, openTx: dTx };
}

// ── Close a position — redeem shares, return principal + yield to the client ──
export interface CloseResult { ok: boolean; dryRun: boolean; returnedUsdc?: number; yieldUsdc?: number; reason?: string; closeTx?: string; }

export async function closePosition(positionId: string): Promise<CloseResult> {
  const l = load();
  const pos = l.positions.find(p => (p.id === positionId || p.jobId === positionId) && p.status === "open");
  if (!pos) return { ok: false, dryRun: MGMT.dryRun, reason: "no open position with that id" };

  const sharesWei = BigInt(pos.sharesWei);
  if (MGMT.dryRun) {
    let est = 0n;
    try { est = await client.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "previewWithdraw", args: [sharesWei] }) as bigint; } catch {}
    const ret = Number(formatUnits(est, 6));
    return { ok: true, dryRun: true, returnedUsdc: ret, yieldUsdc: ret - pos.principalUsdc, reason: `DRY RUN — would redeem ${ret.toFixed(2)} USDC to ${pos.returnAddress}` };
  }

  const wallet = getWallet();
  if (!wallet) return { ok: false, dryRun: false, reason: "no wallet" };
  const me = wallet.account.address;

  // redeem shares → USDC (measure exact received), then transfer to the client
  const before = await client.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [me] }) as bigint;
  const wTx = await wallet.writeContract({ address: VAULT, abi: VAULT_ABI, functionName: "withdraw", args: [sharesWei], account: wallet.account, chain: base });
  await client.waitForTransactionReceipt({ hash: wTx });
  const after = await client.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [me] }) as bigint;
  const redeemed = after - before;

  const tTx = await wallet.writeContract({ address: USDC, abi: ERC20, functionName: "transfer", args: [pos.returnAddress, redeemed], account: wallet.account, chain: base });
  await client.waitForTransactionReceipt({ hash: tTx });

  const returnedUsdc = Number(formatUnits(redeemed, 6));
  pos.status = "closed"; pos.closedAt = Date.now(); pos.returnedUsdc = returnedUsdc; pos.yieldUsdc = returnedUsdc - pos.principalUsdc; pos.closeTx = tTx;
  save(l);
  return { ok: true, dryRun: false, returnedUsdc, yieldUsdc: pos.yieldUsdc, closeTx: tTx };
}

/** Read-only snapshot for the ACP Resource / operator view. */
export async function positionsResource() {
  const a = await aum();
  return {
    manager: "CUSTOS",
    vault: VAULT,
    aum: { openPositions: a.openCount, principalUsdc: a.principalUsdc, currentValueUsdc: a.valueUsdc },
    caps: { maxPerClientUsdc: MGMT.maxPerClient, maxAumUsdc: MGMT.maxAum },
    positions: listPositions().map(p => ({
      id: p.id, client: p.client, principalUsdc: p.principalUsdc,
      raUsdcShares: Number(formatUnits(BigInt(p.sharesWei), 18)),
      status: p.status, openedAt: new Date(p.openedAt).toISOString(),
      returnedUsdc: p.returnedUsdc, yieldUsdc: p.yieldUsdc,
    })),
  };
}
