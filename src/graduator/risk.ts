// ═══════════════════════════════════════════════════════════════════════════
//  graduator/risk.ts — hard caps, enforced before any buy
// ═══════════════════════════════════════════════════════════════════════════

import { G } from "./config.js";
import * as book from "./book.js";
import type { Candidate } from "./discovery.js";
import type { CurveState } from "./execution.js";

export interface EntryDecision { ok: boolean; sizeVirtual: number; reason: string; }

export function checkEntry(c: Candidate, cs: CurveState): EntryDecision {
  const no = (reason: string): EntryDecision => ({ ok: false, sizeVirtual: 0, reason });

  if (cs.graduated) return no("graduated");
  if (book.positionOf(c.token)) return no("already holding");
  if (book.openPositions().length >= G.maxConcurrent) return no(`max concurrent (${G.maxConcurrent})`);
  if (cs.progressPct < G.entryMinProgressPct) return no(`below entry window (${cs.progressPct.toFixed(0)}% < ${G.entryMinProgressPct}%)`);
  if (cs.progressPct > G.entryMaxProgressPct) return no(`above entry window (${cs.progressPct.toFixed(0)}% > ${G.entryMaxProgressPct}%)`);

  const budgetLeft = G.bookBudgetVirtual - book.deployedVirtual();
  if (budgetLeft < 1) return no("book budget exhausted");

  // never be more than maxCurveSharePct of the token's raised VIRTUAL
  const curveShareCap = (G.maxCurveSharePct / 100) * cs.raisedVirtual;

  const size = Math.min(G.perBuyVirtual, G.maxPerTokenVirtual, budgetLeft, curveShareCap);
  if (size < 1) return no(`size too small (curve-share cap ${curveShareCap.toFixed(2)})`);

  return { ok: true, sizeVirtual: Number(size.toFixed(4)), reason: "ok" };
}
