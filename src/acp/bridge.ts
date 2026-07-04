// ═══════════════════════════════════════════════════════════════════════════
//  acp/bridge.ts — Earnings → Arcis bridge
//
//  The other half of Path B. CUSTOS earns USDC as an ACP provider; this routes
//  that revenue into the raUSDC vault and reports the on-chain credit capacity
//  it unlocks. Because AgentCredit is natively raUSDC-collateralized, this loop
//  works TODAY — no oracle, no new contract, no self-purchased token.
//
//    ACP job.completed  →  USDC in agent wallet
//                          → deposit → raUSDC (Arcis vault)
//                          → AgentCredit collateral capacity
//                          → bonds / RWA
//
//  Wallet note: the agent wallet must run in UNRESTRICTED signer mode (or with
//  the Arcis vault/credit addresses allowlisted), because those are not Virtuals
//  contracts. Under the default Restricted mode the ACP earning works but the
//  Arcis deposit is blocked. See ACP.md.
// ═══════════════════════════════════════════════════════════════════════════

import { type Address, parseUnits, formatUnits } from "viem";
import { client, getWallet, ADDR, base, alert } from "../config.js";
import { ERC20_ABI, VAULT_DEP_ABI, CREDIT_RATIO_ABI, txUrl } from "../treasury.js";

const envNum = (k: string, d: number) => { const v = process.env[k]; const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
const envBool = (k: string, d: boolean) => { const v = process.env[k]; if (v == null || v === "") return d; return /^(1|true|yes|on)$/i.test(v); };

export const BRIDGE = {
  enabled: envBool("ACP_BRIDGE_ENABLED", false),  // off by default
  dryRun:  envBool("ACP_BRIDGE_DRY_RUN", true),   // safe default — report, don't move funds
  minUsdc: envNum("ACP_BRIDGE_MIN_USDC", 5),      // only sweep once earnings clear this
  reserveUsdc: envNum("ACP_BRIDGE_RESERVE_USDC", 0), // keep this much USDC liquid in the wallet
};

const USDC = ADDR.usdc;       // 6 decimals
const VAULT = ADDR.vault;     // raUSDC (Arcis)

export interface BridgeResult {
  action: "deposit" | "skip" | "halt";
  dryRun: boolean;
  usdcBalance: number;
  deposited: number;
  sharesReceived: number;
  depositTx?: string;
  ratioPct: number;   // AgentCredit collateral ratio for this agent (e.g. 150 = 150%)
  raUsdcShares: number;
  reason?: string;
}

async function creditView(me: Address) {
  let ratioBps = 0, sharesWei = 0n;
  try { ratioBps = Number(await client.readContract({ address: ADDR.credit, abi: CREDIT_RATIO_ABI, functionName: "getCollateralRatio", args: [me] })); } catch {}
  try { sharesWei = await client.readContract({ address: VAULT, abi: VAULT_DEP_ABI, functionName: "balanceOf", args: [me] }) as bigint; } catch {}
  return { ratioBps, sharesWei };
}

/** Sweep cleared ACP earnings (USDC) into the raUSDC vault and report credit capacity. */
export async function routeEarnings(): Promise<BridgeResult> {
  const wallet = getWallet();
  const base0: BridgeResult = { action: "skip", dryRun: BRIDGE.dryRun, usdcBalance: 0, deposited: 0, sharesReceived: 0, ratioPct: 0, raUsdcShares: 0 };
  if (!wallet) return { ...base0, reason: "no wallet (CUSTOS_PRIVATE_KEY unset)" };
  const me = wallet.account.address;

  const balWei = await client.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const bal = Number(formatUnits(balWei, 6));
  const cv = await creditView(me);
  const withCredit = (r: BridgeResult): BridgeResult => ({ ...r, usdcBalance: bal, ratioPct: cv.ratioBps / 100, raUsdcShares: Number(formatUnits(cv.sharesWei, 18)) });

  if (!BRIDGE.enabled) return withCredit({ ...base0, reason: "ACP_BRIDGE_ENABLED=false" });

  const depositable = bal - BRIDGE.reserveUsdc;
  if (depositable < BRIDGE.minUsdc) return withCredit({ ...base0, reason: `earnings below threshold (${bal.toFixed(2)} USDC, min ${BRIDGE.minUsdc}+${BRIDGE.reserveUsdc} reserve)` });

  const amountWei = parseUnits(depositable.toFixed(6), 6);

  if (BRIDGE.dryRun) {
    let previewShares = 0n;
    try { previewShares = await client.readContract({ address: VAULT, abi: VAULT_DEP_ABI, functionName: "previewDeposit", args: [amountWei] }) as bigint; } catch {}
    return withCredit({ ...base0, action: "deposit", deposited: depositable, sharesReceived: Number(formatUnits(previewShares, 18)),
      reason: `DRY RUN — would deposit ${depositable.toFixed(2)} USDC → ~${Number(formatUnits(previewShares, 18)).toFixed(2)} raUSDC` });
  }

  // ── LIVE ──
  const allowance = await client.readContract({ address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [me, VAULT] }) as bigint;
  if (allowance < amountWei) {
    const aTx = await wallet.writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [VAULT, amountWei], account: wallet.account, chain: base });
    await client.waitForTransactionReceipt({ hash: aTx });
  }
  const before = cv.sharesWei;
  const dTx = await wallet.writeContract({ address: VAULT, abi: VAULT_DEP_ABI, functionName: "deposit", args: [amountWei], account: wallet.account, chain: base });
  await client.waitForTransactionReceipt({ hash: dTx });
  const after = await client.readContract({ address: VAULT, abi: VAULT_DEP_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const shares = after - before;

  const res = withCredit({ ...base0, action: "deposit", deposited: depositable, sharesReceived: Number(formatUnits(shares, 18)), depositTx: dTx });
  res.raUsdcShares = Number(formatUnits(after, 18));
  return res;
}

export function bridgeTxUrl(hash: string) { return txUrl(hash); }
