// ═══════════════════════════════════════════════════════════════════════════
//  graduator/index.ts — The Graduator runtime
//
//  Run:  npm run graduator
//
//  Each cycle: pull the pre-graduation universe → confirm curve progress on-chain
//  → manage exits on open positions → take new entries within risk → report.
//  DRY-RUN paper-trades into a separate book so you can watch a track record form
//  before going live. LIVE only when GRADUATOR_ENABLED=true AND GRADUATOR_DRY_RUN=false.
// ═══════════════════════════════════════════════════════════════════════════

import { parseUnits, formatUnits, type Address } from "viem";
import { alert } from "../config.js";
import { BONDING } from "../treasury.js";
import { G, modeLabel } from "./config.js";
import { fetchPrototypes, type Candidate } from "./discovery.js";
import { curveState, quoteBuy, buy, sell, walletVirtual, txUrl, type CurveState } from "./execution.js";
import * as book from "./book.js";
import * as strat from "./strategy.js";
import { checkEntry } from "./risk.js";

const paper = () => !G.live;

async function takeEntry(c: Candidate, cs: CurveState, size: number) {
  if (paper()) {
    const { out } = quoteBuy(cs, parseUnits(String(size), 18));
    const tokens = Number(formatUnits(out, 18));
    book.open({ token: c.token, symbol: c.symbol, entryVirtual: size, tokensHeld: tokens, entryPct: cs.progressPct, openedAt: Date.now() });
    await alert(`*Graduator · DRY RUN* — would BUY $${c.symbol}\n${size} VIRTUAL → ~${tokens.toFixed(0)} tokens @ ${cs.progressPct.toFixed(0)}% to graduation`, "INFO");
    return;
  }
  const fill = await buy(c.token, size, cs);
  book.open({ token: c.token, symbol: c.symbol, entryVirtual: fill.spent, tokensHeld: fill.received, entryPct: cs.progressPct, openedAt: Date.now(), openTx: fill.tx });
  await alert(`*Graduator · LIVE* — BUY $${c.symbol}\n${fill.spent} VIRTUAL → ${fill.received.toFixed(0)} tokens @ ${cs.progressPct.toFixed(0)}%\n${txUrl(fill.tx)}`, "INFO");
}

async function takeExit(p: book.Position, cs: CurveState, reason: string, valueVirtual: number) {
  if (paper()) {
    const pnl = book.close(p.token, valueVirtual, reason);
    await alert(`*Graduator · DRY RUN* — would SELL $${p.symbol} (${reason})\n${valueVirtual.toFixed(2)} VIRTUAL · P&L ${(pnl ?? 0) >= 0 ? "+" : ""}${(pnl ?? 0).toFixed(2)}`, "INFO");
    return;
  }
  const fill = await sell(p.token, p.tokensHeld, cs);
  const pnl = book.close(p.token, fill.received, reason, fill.tx);
  await alert(`*Graduator · LIVE* — SELL $${p.symbol} (${reason})\n${fill.received.toFixed(2)} VIRTUAL · P&L ${(pnl ?? 0) >= 0 ? "+" : ""}${(pnl ?? 0).toFixed(2)}\n${txUrl(fill.tx)}`, "INFO");
}

export async function runCycle() {
  if (!G.enabled) return;
  if (BONDING === "0x0000000000000000000000000000000000000000") {
    await alert("Graduator: VIRTUALS_BONDING_ADDRESS unset — cannot read curves. Halting cycle.", "WARN");
    return;
  }

  const candidates = await fetchPrototypes();
  const csCache = new Map<string, CurveState | null>();
  const cs = async (t: Address) => { const k = t.toLowerCase(); if (!csCache.has(k)) csCache.set(k, await curveState(t)); return csCache.get(k)!; };

  // ── 1. manage exits on everything we hold ──
  for (const p of book.openPositions()) {
    const state = await cs(p.token);
    if (!state) continue;
    const sig = strat.exitSignal(p, state);
    if (sig.graduatedStuck) { await alert(`Graduator: $${p.symbol} graduated while held — exit on Uniswap manually (curve sell path is closed).`, "WARN"); continue; }
    if (sig.sell) await takeExit(p, state, sig.reason, sig.valueVirtual);
  }

  // ── 2. rank candidates + take entries within risk ──
  const ranked: strat.Ranked[] = [];
  for (const c of candidates) {
    const state = await cs(c.token);
    if (!state) continue;
    ranked.push({ c, cs: state, score: strat.score(c, state) });
  }
  const ordered = strat.rank(ranked);
  for (const r of ordered) {
    const d = checkEntry(r.c, r.cs);
    if (!d.ok) continue;
    await takeEntry(r.c, r.cs, d.sizeVirtual);
    if (book.openPositions().length >= G.maxConcurrent) break;
  }

  // ── 3. periodic book report (only when there's something to say) ──
  const s = book.summary();
  if (s.open > 0 || s.closed > 0) {
    await alert([
      `*Graduator book* — ${modeLabel()}`,
      `Open: ${s.open} · deployed ${s.deployed.toFixed(1)} VIRTUAL`,
      `Realized P&L: ${s.realizedPnl >= 0 ? "+" : ""}${s.realizedPnl.toFixed(2)} VIRTUAL · win rate ${s.winRate.toFixed(0)}% (${s.closed} closed)`,
    ].join("\n"), "INFO");
  }
}

async function main() {
  const wv = await walletVirtual().catch(() => 0);
  console.log(`
  ┌─────────────────────────────────────────────┐
  │  THE GRADUATOR — pre-graduation token trader  │
  └─────────────────────────────────────────────┘
  Mode: ${modeLabel()}   Wallet VIRTUAL: ${wv.toFixed(2)}
  Per buy: ${G.perBuyVirtual}  Book budget: ${G.bookBudgetVirtual}  Max concurrent: ${G.maxConcurrent}
  Entry window: ${G.entryMinProgressPct}–${G.entryMaxProgressPct}%   Target ${G.targetMultiple}x  Stop -${G.stopLossPct}%  Exit@ ${G.exitAtProgressPct}%
  Scan every ${Math.round(G.intervalMs / 1000)}s
  `);
  if (!G.enabled) { console.log("  GRADUATOR_ENABLED=false — idle. Set it to run.\n"); }
  await alert(`The Graduator online — ${modeLabel()}. Scanning the curve.`, "INFO").catch(() => {});
  await runCycle().catch(e => console.error("cycle error:", e));
  setInterval(() => runCycle().catch(e => console.error("cycle error:", e)), G.intervalMs);
}

main().catch(e => { console.error("fatal:", e); process.exit(1); });
