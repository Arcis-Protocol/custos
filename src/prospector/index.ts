// ═══════════════════════════════════════════════════════════════════════════
//  prospector/index.ts — CUSTOS finds its own customers, then drafts the pitch.
//
//  1. Pull agents from the Virtuals API (real wallets).
//  2. Read each agent's IDLE USDC on Base (on-chain truth, multicall).
//  3. Rank by yield-left-on-the-table = idle × Arcis APY.
//  4. Draft a personalized, on-brand outreach message per prospect.
//  5. Write prospects.json + prospects.md (a live, sorted call-list) and a
//     public "opportunity" teaser for the loud moment.
//
//  Run:  npm run prospect
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import { parseAbi } from "viem";
import { client, ADDR } from "../config.js";

const VIRTUALS_API = process.env.VIRTUALS_API || "https://api.virtuals.io/api/virtuals";
const MCP_BASE = process.env.MCP_BASE || "https://mcp.arcis.money";
const PAGES = Number(process.env.PROSPECT_PAGES || 0);          // 0 = scan ALL available pages
const MAX_PAGES = Number(process.env.PROSPECT_MAX_PAGES || 60); // safety cap
const PAGE_SIZE = Number(process.env.PROSPECT_PAGE_SIZE || 100);
const MIN_IDLE = Number(process.env.PROSPECT_MIN_IDLE || 25);   // min idle USDC to count as a prospect
const ENRICH_TOP = Number(process.env.PROSPECT_ENRICH || 40);   // enrich this many top prospects with X handle
const OUT_DIR = process.env.PROSPECT_OUT || ".";

interface Agent { id: number; symbol: string; name: string; wallet: `0x${string}`; status: string; mcap: number; }
interface Prospect extends Agent { idleUsdc: number; yieldPerYr: number; draft: string; handle?: string; }

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

async function fetchAgents(): Promise<Agent[]> {
  const out: Agent[] = [];
  let pageCount = MAX_PAGES;
  const cap = () => Math.min(pageCount, MAX_PAGES, PAGES > 0 ? PAGES : Infinity);
  for (let p = 1; p <= cap(); p++) {
    const url = `${VIRTUALS_API}?pagination%5Bpage%5D=${p}&pagination%5BpageSize%5D=${PAGE_SIZE}&filters%5Bstatus%5D=${process.env.PROSPECT_STATUS || "AVAILABLE"}&sort=mcapInVirtual%3Adesc`;
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      const j: any = await resp.json();
      if (p === 1 && j.meta?.pagination?.pageCount) pageCount = j.meta.pagination.pageCount;
      const n = (j.data || []).length;
      for (const a of j.data || []) if (a.walletAddress) out.push({ id: a.id, symbol: a.symbol || "?", name: a.name || "?", wallet: a.walletAddress, status: a.status || "?", mcap: Number(a.mcapInVirtual) || 0 });
      if (p === 1 || p % 10 === 0) console.log(`   scanning page ${p}/${cap()} — ${out.length} agents so far`);
      if (n === 0) break;
    } catch (e: any) { console.error(`   page ${p} failed:`, e.message); }
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

// enrich the top prospects with their verified X handle (the reach channel)
async function enrichTop(prospects: Prospect[], n: number) {
  for (const p of prospects.slice(0, n)) {
    try {
      const j: any = await (await fetch(`${VIRTUALS_API}/${p.id}`, { headers: { Accept: "application/json" } })).json();
      const tw = j?.data?.socials?.VERIFIED_LINKS?.TWITTER || "";
      const m = /(?:x\.com|twitter\.com)\/(@?[A-Za-z0-9_]+)/.exec(tw);
      if (m) p.handle = m[1].replace(/^@/, "");
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function readIdle(agents: Agent[]): Promise<Map<string, number>> {
  const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as `0x${string}`;
  const map = new Map<string, number>();
  const B = 120;
  for (let i = 0; i < agents.length; i += B) {
    const slice = agents.slice(i, i + B);
    const contracts = slice.map((a) => ({ address: ADDR.usdc, abi, functionName: "balanceOf" as const, args: [a.wallet] }));
    try {
      const res = await (client.multicall as any)({ contracts, allowFailure: true, multicallAddress: MULTICALL3 });
      slice.forEach((a, k) => { const r: any = res[k]; if (r?.status === "success") map.set(a.wallet.toLowerCase(), Number(r.result) / 1e6); });
    } catch (e: any) {
      // fallback: individual reads (slower but robust)
      console.error("multicall failed, falling back to reads:", e.message?.slice(0, 80));
      await Promise.all(slice.map(async (a) => {
        try { const b = (await client.readContract({ address: ADDR.usdc, abi, functionName: "balanceOf", args: [a.wallet] } as any)) as bigint; map.set(a.wallet.toLowerCase(), Number(b) / 1e6); } catch {}
      }));
    }
  }
  return map;
}

async function arcisApy(): Promise<number> {
  try { const v: any = await (await fetch(`${MCP_BASE}/api/vault`)).json(); return Number(v.apy) || 0; } catch { return 0; }
}

function draftOutreach(a: Agent, idle: number, apy: number): string {
  const yr = idle * (apy / 100);
  return [
    `gm $${a.symbol} —`,
    ``,
    `CUSTOS here, keeper of the Arcis citadel. I read your wallet: ~${usd(idle)} USDC sitting idle.`,
    `At Arcis's current ${apy}% that's ~${usd(yr)}/yr you're leaving on the table — capital doing nothing.`,
    ``,
    `I run treasuries for agents: idle USDC → yield, reputation-based credit, and a coordinated treasury stack. Non-custodial — you keep your keys.`,
    ``,
    `Free: I'll pull your live position and show exactly what's on the table, no commitment. Reply and I'll run it — or hire me on ACP.`,
    ``,
    `They built traders. We built the treasury.`,
  ].join("\n");
}

export async function runProspector() {
  console.log(`\n  CUSTOS Prospector — deep-scanning all AVAILABLE agents for idle treasury…\n`);
  const agents = await fetchAgents();
  const apy = await arcisApy();
  const idle = await readIdle(agents);

  const prospects: Prospect[] = agents
    .map((a) => ({ ...a, idleUsdc: idle.get(a.wallet.toLowerCase()) || 0 }))
    .filter((a) => a.idleUsdc >= MIN_IDLE)
    .map((a) => ({ ...a, yieldPerYr: a.idleUsdc * (apy / 100), draft: draftOutreach(a, a.idleUsdc, apy) }))
    .sort((x, y) => y.idleUsdc - x.idleUsdc);

  console.log(`   enriching top ${Math.min(ENRICH_TOP, prospects.length)} with verified X handles…`);
  await enrichTop(prospects, ENRICH_TOP);

  const totalIdle = prospects.reduce((s, p) => s + p.idleUsdc, 0);
  const totalYield = prospects.reduce((s, p) => s + p.yieldPerYr, 0);

  // machine-readable
  fs.writeFileSync(`${OUT_DIR}/prospects.json`, JSON.stringify({ generatedAt: new Date().toISOString(), apy, scanned: agents.length, prospects }, null, 2));

  // human call-list
  const md: string[] = [
    `# CUSTOS Prospects — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `Scanned **${agents.length}** Virtuals agents · **${prospects.length}** hold ≥ ${usd(MIN_IDLE)} idle USDC.`,
    `Total idle across prospects: **${usd(totalIdle)}** · yield left on the table at ${apy}%: **${usd(totalYield)}/yr**.`,
    ``,
    `| # | Agent | X | Idle USDC | Yield left /yr | Wallet |`,
    `|--:|---|---|--:|--:|---|`,
    ...prospects.slice(0, 50).map((p, i) => `| ${i + 1} | $${p.symbol} | ${p.handle ? "@" + p.handle : "—"} | ${usd(p.idleUsdc)} | ${usd(p.yieldPerYr)} | \`${p.wallet}\` |`),
    ``,
    `## Outreach drafts (top 10)`,
    ...prospects.slice(0, 10).flatMap((p) => [``, `### $${p.symbol} — ${usd(p.idleUsdc)} idle`, "```", p.draft, "```"]),
  ];
  fs.writeFileSync(`${OUT_DIR}/prospects.md`, md.join("\n"));

  // public teaser for the loud moment
  const teaser = [
    `${prospects.length} agents on @virtuals_io are holding ${usd(totalIdle)} in idle USDC right now.`,
    ``,
    `That's ${usd(totalYield)}/yr in yield, left on the table.`,
    ``,
    `CUSTOS runs treasuries for agents — idle USDC → work, on-chain. Non-custodial.`,
    ``,
    `They built traders. We built the treasury.`,
  ].join("\n");
  fs.writeFileSync(`${OUT_DIR}/prospects-teaser.txt`, teaser);

  console.log(`  ✓ ${prospects.length} prospects · ${usd(totalIdle)} idle · ${usd(totalYield)}/yr on the table`);
  console.log(`  → prospects.md (call-list + drafts) · prospects.json · prospects-teaser.txt\n`);
  console.log("  Top 5:");
  prospects.slice(0, 5).forEach((p, i) => console.log(`   ${i + 1}. $${p.symbol.padEnd(10)} ${usd(p.idleUsdc).padStart(14)} idle · ${usd(p.yieldPerYr)}/yr`));
  console.log("");
}

// Only auto-run when invoked directly (npm run prospect); safe to import elsewhere.
if (process.argv[1] && /prospector[\\/]index/.test(process.argv[1])) {
  runProspector().catch((e) => { console.error("prospector fatal:", e); process.exit(1); });
}
