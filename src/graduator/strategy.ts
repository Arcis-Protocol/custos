// ═══════════════════════════════════════════════════════════════════════════
//  graduator/strategy.ts — the edge (heuristic v1, unproven — watch it in dry-run)
//
//  Thesis: graduation-proximity momentum. Prefer tokens progressing through the
//  mid-to-upper curve with positive momentum and a broad-ish holder base (not one
//  whale). Exit into strength: a profit target, a stop, the graduation run-up, or
//  a time limit.
// ═══════════════════════════════════════════════════════════════════════════

import { formatUnits, parseUnits } from "viem";
import { G } from "./config.js";
import type { Candidate } from "./discovery.js";
import { type CurveState, quoteSell } from "./execution.js";
import type { Position } from "./book.js";

/** Higher = more attractive. Pure heuristic — tune against dry-run results. */
export function score(c: Candidate, cs: CurveState): number {
  // progress term: reward being inside the window, peaking toward the upper-mid curve
  const mid = (G.entryMinProgressPct + G.entryMaxProgressPct) / 2;
  const span = (G.entryMaxProgressPct - G.entryMinProgressPct) / 2 || 1;
  const progressTerm = 1 - Math.min(1, Math.abs(cs.progressPct - (mid + span * 0.4)) / span); // 0..1, peaks upper-mid

  // momentum term: positive 24h change helps; unknown = neutral
  const mom = c.apiMomentum ?? 0;
  const momentumTerm = Math.max(0, Math.min(1, mom / 50)); // +50% → 1.0

  // breadth term: more holders = less single-whale risk
  const breadthTerm = c.holders ? Math.min(1, Math.log10(1 + c.holders) / 3) : 0.3;

  return progressTerm * 0.5 + momentumTerm * 0.3 + breadthTerm * 0.2;
}

export interface Ranked { c: Candidate; cs: CurveState; score: number; }
export function rank(items: Ranked[]): Ranked[] {
  return items
    .filter(x => !x.cs.graduated && x.cs.progressPct >= G.entryMinProgressPct && x.cs.progressPct <= G.entryMaxProgressPct)
    .sort((a, b) => b.score - a.score);
}

export interface ExitSignal { sell: boolean; reason: string; valueVirtual: number; graduatedStuck?: boolean; }
export function exitSignal(p: Position, cs: CurveState): ExitSignal {
  // if it graduated while we held it, the curve sell path is gone — flag for manual/Uniswap exit
  if (cs.graduated) return { sell: false, reason: "graduated — needs manual/Uniswap exit", valueVirtual: 0, graduatedStuck: true };

  const { out } = quoteSell(cs, parseUnits(p.tokensHeld.toFixed(18), 18));
  const valueVirtual = Number(formatUnits(out, 18));

  if (cs.progressPct >= G.exitAtProgressPct) return { sell: true, reason: `graduation run-up (${cs.progressPct.toFixed(0)}%)`, valueVirtual };
  if (valueVirtual >= p.entryVirtual * G.targetMultiple) return { sell: true, reason: `target +${((G.targetMultiple - 1) * 100).toFixed(0)}%`, valueVirtual };
  if (valueVirtual <= p.entryVirtual * (1 - G.stopLossPct / 100)) return { sell: true, reason: `stop -${G.stopLossPct}%`, valueVirtual };
  if (Date.now() - p.openedAt > G.maxHoldHours * 3600_000) return { sell: true, reason: `time stop (${G.maxHoldHours}h)`, valueVirtual };

  return { sell: false, reason: "hold", valueVirtual };
}
