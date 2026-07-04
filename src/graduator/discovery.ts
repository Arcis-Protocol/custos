// ═══════════════════════════════════════════════════════════════════════════
//  graduator/discovery.ts — the pre-graduation universe
//
//  Pulls prototype (un-graduated) agent tokens from the Virtuals API for the
//  candidate list, then the strategy confirms each one's TRUE curve progress
//  on-chain (execution.curveState). API for breadth, chain for truth.
//
//  Defensive by design: any fetch/parse failure returns an empty list → the
//  loop simply trades nothing that cycle. It can never act on bad data.
// ═══════════════════════════════════════════════════════════════════════════

import { type Address } from "viem";
import { G } from "./config.js";

export interface Candidate {
  token: Address;
  symbol: string;
  name: string;
  apiMomentum?: number; // 24h price change %, if the API provides it
  apiVolume?: number;   // 24h volume, if provided
  holders?: number;
  createdAt?: number;
}

// pull an address out of whatever field the API uses
function addrOf(x: any): string | null {
  const cands = [x?.preToken, x?.preTokenAddress, x?.tokenAddress, x?.contractAddress, x?.token?.address, x?.address];
  for (const c of cands) {
    const s = typeof c === "string" ? c : c?.address;
    if (typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s)) return s;
  }
  return null;
}
const numOf = (...xs: any[]) => { for (const x of xs) { const n = Number(x); if (Number.isFinite(n)) return n; } return undefined; };

export async function fetchPrototypes(): Promise<Candidate[]> {
  const url = process.env.GRADUATOR_API_URL ||
    `${G.apiBase}?filters[status]=UNDERGRAD&filters[chain]=BASE&sort[0]=createdAt%3Adesc&pagination[page]=1&pagination[pageSize]=${G.maxCandidates}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const json: any = await res.json();
    const rows: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const out: Candidate[] = [];
    for (const r of rows) {
      // skip anything already graduated / not on the curve
      const status = String(r?.status || r?.tokenStatus || "").toUpperCase();
      if (status && !/UNDERGRAD|PROTOTYPE|BONDING|CURVE/.test(status)) continue;
      const token = addrOf(r);
      if (!token) continue;
      out.push({
        token: token as Address,
        symbol: String(r?.symbol || r?.tokenTicker || "?").slice(0, 12),
        name: String(r?.name || r?.tokenName || "").slice(0, 40),
        apiMomentum: numOf(r?.priceChangePercent24h, r?.priceChange24h, r?.change24h),
        apiVolume: numOf(r?.volume24h, r?.volume, r?.totalValueLocked),
        holders: numOf(r?.holderCount, r?.holders),
        createdAt: numOf(r?.createdAt ? Date.parse(r.createdAt) : undefined, r?.createdAtUnix),
      });
    }
    return out.slice(0, G.maxCandidates);
  } catch {
    return [];
  }
}
