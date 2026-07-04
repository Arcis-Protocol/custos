// ═══════════════════════════════════════════════════════════════════════════
//  graduator/config.ts — The Graduator's own config
//
//  A SEPARATE agent from CUSTOS: its own dedicated hot wallet (GRADUATOR_PRIVATE_KEY),
//  its own bounded book, its own risk. Never touches the keeper's treasury wallet.
//  Ships OFF + dry-run; live is an explicit two-flag flip.
// ═══════════════════════════════════════════════════════════════════════════

import { type Address, createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "../config.js";

const num = (k: string, d: number) => { const v = process.env[k]; const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
const bool = (k: string, d: boolean) => { const v = process.env[k]; if (v == null || v === "") return d; return /^(1|true|yes|on)$/i.test(v); };

export const G = {
  // ── master gates (both must flip for live trading) ──
  enabled:  bool("GRADUATOR_ENABLED", false),
  live:     !bool("GRADUATOR_DRY_RUN", true),   // dry-run is the default; live only when DRY_RUN=false

  // ── sizing / book caps ──
  perBuyVirtual:     num("GRADUATOR_PER_BUY_VIRTUAL", 5),      // $VIRTUAL per entry
  bookBudgetVirtual: num("GRADUATOR_BOOK_BUDGET_VIRTUAL", 50), // total capital the book may deploy
  maxPerTokenVirtual:num("GRADUATOR_MAX_PER_TOKEN_VIRTUAL", 10),
  maxConcurrent:     num("GRADUATOR_MAX_CONCURRENT", 5),
  maxCurveSharePct:  num("GRADUATOR_MAX_CURVE_SHARE_PCT", 3),  // never be >N% of a token's raised VIRTUAL

  // ── entry window (buy tokens progressing through this band of the curve) ──
  entryMinProgressPct: num("GRADUATOR_ENTRY_MIN_PCT", 25),
  entryMaxProgressPct: num("GRADUATOR_ENTRY_MAX_PCT", 85),     // don't chase ones already at the doorstep

  // ── exits ──
  targetMultiple:      num("GRADUATOR_TARGET_MULTIPLE", 1.6),  // take profit at +60%
  stopLossPct:         num("GRADUATOR_STOP_LOSS_PCT", 35),     // cut at -35%
  exitAtProgressPct:   num("GRADUATOR_EXIT_AT_PCT", 95),       // sell into the graduation run-up (avoid Uniswap migration)
  maxHoldHours:        num("GRADUATOR_MAX_HOLD_HOURS", 72),    // time stop

  // ── execution ──
  maxSlippageBps: num("GRADUATOR_MAX_SLIPPAGE_BPS", 500),      // 5% floor (thin curves move fast)
  intervalMs:     num("GRADUATOR_INTERVAL_MS", 300_000),       // scan every 5 min
  maxCandidates:  num("GRADUATOR_MAX_CANDIDATES", 40),         // cap on-chain reads per cycle

  // ── discovery ──
  apiBase: process.env.GRADUATOR_API_BASE || "https://api.virtuals.io/api/virtuals",
};

export const STATE_PATH = process.env.GRADUATOR_BOOK_PATH ||
  (G.live ? "./.graduator-book.json" : "./.graduator-book.dry.json");

/** The Graduator's dedicated trading wallet — a hot EOA holding only the book's capital. */
export function getGraduatorWallet(): WalletClient | null {
  const pk = process.env.GRADUATOR_PRIVATE_KEY;
  if (!pk) return null;
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk as `0x${string}` : `0x${pk}`);
  return createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL || undefined) });
}

export function modeLabel(): string {
  if (!G.enabled) return "disabled";
  return G.live ? "LIVE" : "DRY RUN";
}
