// ═══════════════════════════════════════════════════════════════════════════
//  graduator/book.ts — the position ledger
//
//  Per-token positions with VIRTUAL cost basis + realized P&L. In dry-run it
//  writes to a separate paper-book file, so you can watch a full paper track
//  record accumulate tonight before a cent is at risk.
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import { type Address } from "viem";
import { STATE_PATH } from "./config.js";

export interface Position {
  token: Address;
  symbol: string;
  entryVirtual: number;   // VIRTUAL spent (cost basis)
  tokensHeld: number;
  entryPct: number;       // curve progress at entry
  openedAt: number;
  openTx?: string;
  status: "open" | "closed";
  closedAt?: number;
  exitVirtual?: number;   // VIRTUAL received on close
  pnlVirtual?: number;
  closeReason?: string;
  closeTx?: string;
}
interface Book { positions: Position[]; realizedPnlVirtual: number; }

export function load(): Book {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { positions: [], realizedPnlVirtual: 0 }; }
}
function save(b: Book) { try { fs.writeFileSync(STATE_PATH, JSON.stringify(b, null, 2)); } catch {} }

export const openPositions = () => load().positions.filter(p => p.status === "open");
export const positionOf = (token: Address) => load().positions.find(p => p.status === "open" && p.token.toLowerCase() === token.toLowerCase());
export const deployedVirtual = () => openPositions().reduce((a, p) => a + p.entryVirtual, 0);

export function open(p: Omit<Position, "status">) {
  const b = load();
  if (b.positions.find(x => x.status === "open" && x.token.toLowerCase() === p.token.toLowerCase())) return; // no double-open
  b.positions.push({ ...p, status: "open" });
  save(b);
}

export function close(token: Address, exitVirtual: number, reason: string, closeTx?: string) {
  const b = load();
  const p = b.positions.find(x => x.status === "open" && x.token.toLowerCase() === token.toLowerCase());
  if (!p) return;
  p.status = "closed"; p.closedAt = Date.now(); p.exitVirtual = exitVirtual;
  p.pnlVirtual = exitVirtual - p.entryVirtual; p.closeReason = reason; p.closeTx = closeTx;
  b.realizedPnlVirtual = (b.realizedPnlVirtual || 0) + p.pnlVirtual;
  save(b);
  return p.pnlVirtual;
}

export function summary() {
  const b = load();
  const open = b.positions.filter(p => p.status === "open");
  const wins = b.positions.filter(p => p.status === "closed" && (p.pnlVirtual || 0) > 0).length;
  const closed = b.positions.filter(p => p.status === "closed").length;
  return {
    open: open.length,
    deployed: open.reduce((a, p) => a + p.entryVirtual, 0),
    realizedPnl: b.realizedPnlVirtual || 0,
    closed, wins, winRate: closed ? (wins / closed) * 100 : 0,
  };
}
