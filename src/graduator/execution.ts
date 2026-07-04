// ═══════════════════════════════════════════════════════════════════════════
//  graduator/execution.ts — buy/sell ANY pre-graduation token
//
//  Reuses the verified Virtuals Bonding adapter from treasury.ts (same ABIs,
//  same FRouter approval model), generalized from $CUSTOS to an arbitrary token.
//  Curve exits happen on the bonding curve (sell before graduation) — no Uniswap
//  path needed in v1; the strategy exits at GRADUATOR_EXIT_AT_PCT.
// ═══════════════════════════════════════════════════════════════════════════

import { type Address, parseUnits, formatUnits } from "viem";
import { client, base, EXPLORER } from "../config.js";
import { VIRTUAL, BONDING, GRAD_THRESHOLD_VIRTUAL, ERC20_ABI, BONDING_ABI, FROUTER_ABI, FFACTORY_ABI, FPAIR_ABI } from "../treasury.js";
import { G, getGraduatorWallet } from "./config.js";

const dl = () => BigInt(Math.floor(Date.now() / 1000) + 300);
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

async function factory(): Promise<Address> {
  return await client.readContract({ address: BONDING, abi: BONDING_ABI, functionName: "factory" }) as Address;
}
export async function pairOf(token: Address): Promise<Address> {
  const f = await factory();
  return await client.readContract({ address: f, abi: FFACTORY_ABI, functionName: "getPair", args: [token, VIRTUAL] }) as Address;
}

export interface CurveState { pair: Address; raisedVirtual: number; progressPct: number; graduated: boolean; reserveToken: bigint; reserveAsset: bigint; }
export async function curveState(token: Address): Promise<CurveState | null> {
  try {
    const pair = await pairOf(token);
    if (!pair || pair === "0x0000000000000000000000000000000000000000") return null;
    const [reserveToken, reserveAsset] = await client.readContract({ address: pair, abi: FPAIR_ABI, functionName: "getReserves" }) as [bigint, bigint];
    const assetWei = await client.readContract({ address: pair, abi: FPAIR_ABI, functionName: "assetBalance" }) as bigint;
    const tokenBal = await client.readContract({ address: pair, abi: FPAIR_ABI, functionName: "balance" }) as bigint;
    const raised = Number(formatUnits(assetWei, 18));
    return { pair, raisedVirtual: raised, progressPct: Math.min(100, (raised / GRAD_THRESHOLD_VIRTUAL) * 100), graduated: tokenBal === 0n, reserveToken, reserveAsset };
  } catch { return null; }
}

// reserve-based quotes (the on-chain amountOutMin is the real protection; these derive a floor)
export function quoteBuy(cs: CurveState, virtualInWei: bigint): { out: bigint; minOut: bigint } {
  const inAfterFee = (virtualInWei * 99n) / 100n;
  const out = (cs.reserveToken * inAfterFee) / (cs.reserveAsset + inAfterFee);
  return { out, minOut: (out * BigInt(10_000 - G.maxSlippageBps)) / 10_000n };
}
export function quoteSell(cs: CurveState, tokenInWei: bigint): { out: bigint; minOut: bigint } {
  const inAfterFee = (tokenInWei * 99n) / 100n;
  const out = (cs.reserveAsset * inAfterFee) / (cs.reserveToken + inAfterFee); // VIRTUAL out
  return { out, minOut: (out * BigInt(10_000 - G.maxSlippageBps)) / 10_000n };
}

async function frouter(): Promise<Address> {
  return await client.readContract({ address: BONDING, abi: BONDING_ABI, functionName: "router" }) as Address;
}

export interface Fill { tx: string; received: number; spent: number; }

/** LIVE buy: approve VIRTUAL→FRouter, Bonding.buy(token). Returns tokens received + VIRTUAL spent. */
export async function buy(token: Address, virtualAmount: number, cs: CurveState): Promise<Fill> {
  const wallet = getGraduatorWallet(); if (!wallet) throw new Error("no GRADUATOR_PRIVATE_KEY");
  const me = wallet.account!.address;
  const amountInWei = parseUnits(String(virtualAmount), 18);
  const { minOut } = quoteBuy(cs, amountInWei);
  const router = await frouter();
  const allow = await client.readContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "allowance", args: [me, router] }) as bigint;
  if (allow < amountInWei) {
    const a = await wallet.writeContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "approve", args: [router, amountInWei], account: wallet.account!, chain: base });
    await client.waitForTransactionReceipt({ hash: a });
  }
  const before = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const tx = await wallet.writeContract({ address: BONDING, abi: BONDING_ABI, functionName: "buy", args: [amountInWei, token, minOut, dl()], account: wallet.account!, chain: base });
  await client.waitForTransactionReceipt({ hash: tx });
  const after = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  return { tx, received: Number(formatUnits(after - before, 18)), spent: virtualAmount };
}

/** LIVE sell: approve token→FRouter, Bonding.sell(token). Returns VIRTUAL received. */
export async function sell(token: Address, tokenAmount: number, cs: CurveState): Promise<Fill> {
  const wallet = getGraduatorWallet(); if (!wallet) throw new Error("no GRADUATOR_PRIVATE_KEY");
  const me = wallet.account!.address;
  const amountInWei = parseUnits(tokenAmount.toFixed(18), 18);
  const { minOut } = quoteSell(cs, amountInWei);
  const router = await frouter();
  const allow = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [me, router] }) as bigint;
  if (allow < amountInWei) {
    const a = await wallet.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [router, amountInWei], account: wallet.account!, chain: base });
    await client.waitForTransactionReceipt({ hash: a });
  }
  const before = await client.readContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  const tx = await wallet.writeContract({ address: BONDING, abi: BONDING_ABI, functionName: "sell", args: [amountInWei, token, minOut, dl()], account: wallet.account!, chain: base });
  await client.waitForTransactionReceipt({ hash: tx });
  const after = await client.readContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }) as bigint;
  return { tx, received: Number(formatUnits(after - before, 18)), spent: tokenAmount };
}

export async function walletVirtual(): Promise<number> {
  const wallet = getGraduatorWallet(); if (!wallet) return 0;
  const b = await client.readContract({ address: VIRTUAL, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet.account!.address] }) as bigint;
  return Number(formatUnits(b, 18));
}
