// ═══════════════════════════════════════════════════════════════════════════
//  treasury-steward.ts — CUSTOS's flagship managed-treasury service.
//
//  ONE skill that stacks the entire treasury stack into a single subscription:
//    • live position + reward tracking          (from /api/position)
//    • idle-capital deployment guidance          (stop the drag, respect a floor)
//    • yield capture & return-on-capital          (realized + unrealized)
//    • credit-headroom management                 (borrow without unwinding)
//    • liquidity / reserve guarding               (withdrawal readiness)
//    • risk alerts + a per-client digest every cycle
//
//  Sold via ACP as a monthly subscription — see acp/offerings.ts → MANAGED_TREASURY.
//  The ACP provider calls subscribe()/unsubscribe() on job accept/close and
//  reportFor() to produce each cycle's deliverable.
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import * as path from "path";
import { client, ADDR, VAULT_ABI, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";
import { treasuryReview } from "./treasury-stack.js";

const MCP_BASE = process.env.MCP_BASE || "https://mcp.arcis.money";
const STORE = process.env.STEWARD_STORE || "data/steward-subscribers.json";
const DAY_MS = 86_400_000;

const USDC_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

type Tier = "standard" | "prime";

export interface Subscription {
  agent: `0x${string}`;
  tier: Tier;
  since: number;              // unix ms
  cadenceDays: number;        // digest cadence
  liquidityFloorUsdc: number; // USDC to always keep liquid
  lastCycle: number;          // unix ms
  cyclesRun: number;
  lastValueUsdc: number;      // last observed live value (for deltas)
  active: boolean;
}

interface ProtocolCtx { reserveRatio: number; paused: boolean; }

export class TreasurySteward implements Skill {
  name = "TreasurySteward";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private subs = new Map<string, Subscription>();

  constructor() { this.load(); }

  // ── Subscription lifecycle (called by the ACP provider) ──────────────────
  subscribe(agent: string, opts: Partial<Pick<Subscription, "tier" | "cadenceDays" | "liquidityFloorUsdc">> = {}): Subscription {
    const key = agent.toLowerCase();
    const sub: Subscription = this.subs.get(key) ?? {
      agent: agent as `0x${string}`, tier: "standard", since: Date.now(),
      cadenceDays: 1, liquidityFloorUsdc: 0, lastCycle: 0, cyclesRun: 0, lastValueUsdc: 0, active: true,
    };
    sub.active = true;
    if (opts.tier) sub.tier = opts.tier;
    if (opts.cadenceDays != null) sub.cadenceDays = opts.cadenceDays;
    if (opts.liquidityFloorUsdc != null) sub.liquidityFloorUsdc = opts.liquidityFloorUsdc;
    this.subs.set(key, sub); this.save();
    return sub;
  }

  unsubscribe(agent: string): void {
    const s = this.subs.get(agent.toLowerCase());
    if (s) { s.active = false; this.save(); }
  }

  list(): Subscription[] { return [...this.subs.values()].filter((s) => s.active); }

  /** Run a cycle for one agent on demand and return the digest — for the ACP deliverable. */
  async reportFor(agent: string): Promise<string> {
    const sub = this.subs.get(agent.toLowerCase()) ?? this.subscribe(agent);
    const ctx = await this.protocolCtx();
    return (await this.manageOne(sub, ctx)).join("\n");
  }

  // ── The managed cycle ────────────────────────────────────────────────────
  async run(): Promise<void> {
    this.runs++; this.lastRun = Date.now();
    this.load(); // pick up subscriptions written by the ACP provider process
    const due = this.list().filter((s) => s.cyclesRun === 0 || Date.now() - s.lastCycle >= s.cadenceDays * DAY_MS);
    if (due.length === 0) return;

    const ctx = await this.protocolCtx();
    for (const sub of due) {
      try {
        const digest = await this.manageOne(sub, ctx);
        await alert(digest.join("\n"), "INFO"); // surfaced to the operator; ACP delivers via reportFor()
      } catch (e: any) {
        this.errors++;
        console.error("[STEWARD]", sub.agent, e.message?.slice(0, 80));
      }
    }
    this.save();
  }

  private async manageOne(sub: Subscription, ctx: ProtocolCtx): Promise<string[]> {
    const pos = await this.position(sub.agent);
    const idle = await this.idleUsdc(sub.agent);
    const value = pos?.liveValue ?? 0;
    const earned = pos?.earned ?? 0;
    const net = pos?.netDeposited ?? 0;
    const deployable = Math.max(0, idle - sub.liquidityFloorUsdc);

    const L: string[] = [];
    L.push(`*CUSTOS Treasury Steward* — managed digest (${sub.tier})`);
    L.push(`Agent: \`${sub.agent}\``);
    L.push(`Position value: $${value.toFixed(2)}  ·  earned: $${earned.toFixed(4)}  ·  net in: $${net.toFixed(2)}`);
    if (net > 0) L.push(`Return on capital: ${((earned / net) * 100).toFixed(3)}%`);

    // 1) Idle-capital deployment
    if (deployable >= 1) {
      this.actions++;
      L.push(`Idle USDC: $${idle.toFixed(2)} (floor $${sub.liquidityFloorUsdc.toFixed(2)}) → *deploy $${deployable.toFixed(2)}* into the vault to stop the drag.`);
    } else if (idle > 0) {
      L.push(`Idle USDC: $${idle.toFixed(2)} — within liquidity floor, held liquid.`);
    }

    // 2) Credit headroom (borrow without unwinding; prime unlocks a higher LTV)
    if (value > 0) {
      const ltv = sub.tier === "prime" ? 0.6 : 0.5;
      L.push(`Credit headroom: ~$${(value * ltv).toFixed(2)} available via AgentCredit at current tier.`);
    }

    // 3) Liquidity / reserve guard
    if (ctx.reserveRatio < 0.1) L.push(`⚠ Vault reserve ${(ctx.reserveRatio * 100).toFixed(1)}% — instant-withdrawal headroom is thin.`);
    else L.push(`Liquidity: reserve ${(ctx.reserveRatio * 100).toFixed(0)}% — withdrawals servicing normally.`);

    // 4) Risk alerts (urgent → alert channel immediately)
    const urgent: string[] = [];
    if (ctx.paused) urgent.push("Vault is PAUSED — deposits/withdrawals blocked.");
    if (sub.lastValueUsdc > 0 && value < sub.lastValueUsdc * 0.9) {
      urgent.push(`Position value fell ${(((sub.lastValueUsdc - value) / sub.lastValueUsdc) * 100).toFixed(1)}% since last cycle.`);
    }
    if (urgent.length) await alert(`Steward alert — ${sub.agent}:\n- ${urgent.join("\n- ")}`, "WARN");

    // persist cycle state
    sub.lastValueUsdc = value;
    sub.lastCycle = Date.now();
    sub.cyclesRun++;

    // 5) Coordinated treasury review — the eight-part stack
    try {
      const review = await treasuryReview(sub.agent);
      const risks = review.findings.filter((f) => f.severity === "risk").length;
      const acts = review.findings.filter((f) => f.severity === "action").length;
      L.push(`Treasury review: ${review.findings.length} findings · ${risks} risk · ${acts} action.`);
      for (const g of review.gates) L.push(`  ⚠ ${g}`);
      for (const a of review.actions.slice(0, 4)) L.push(`  ◆ ${a}`);
    } catch {}

    return L;
  }
  private async protocolCtx(): Promise<ProtocolCtx> {
    try {
      const [reserve, total, paused] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "paused" }) as Promise<boolean>,
      ]);
      return { reserveRatio: total > 0n ? Number((reserve * 10000n) / total) / 10000 : 1, paused };
    } catch {
      return { reserveRatio: 1, paused: false };
    }
  }

  private async position(agent: string): Promise<{ liveValue: number; earned: number; netDeposited: number } | null> {
    try {
      const r = await fetch(`${MCP_BASE}/api/position?address=${agent}`);
      const p: any = await r.json();
      const to = (x: any) => (x == null ? 0 : Number(x) / 1e6);
      return { liveValue: to(p.liveValue ?? p.value), earned: to(p.earned), netDeposited: to(p.netDeposited) };
    } catch {
      return null;
    }
  }

  private async idleUsdc(agent: string): Promise<number> {
    try {
      const b = await client.readContract({ address: ADDR.usdc, abi: USDC_ABI, functionName: "balanceOf", args: [agent as `0x${string}`] }) as bigint;
      return Number(b) / 1e6;
    } catch {
      return 0;
    }
  }

  // ── Persistence (best-effort; ACP remains the source of truth) ────────────
  private load(): void {
    try {
      for (const s of JSON.parse(fs.readFileSync(STORE, "utf8")) as Subscription[]) {
        this.subs.set(s.agent.toLowerCase(), s);
      }
    } catch { /* no store yet */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(STORE), { recursive: true });
      fs.writeFileSync(STORE, JSON.stringify([...this.subs.values()], null, 2));
    } catch { /* ephemeral fs — fine */ }
  }

  stats(): SkillStats {
    const active = this.list();
    return {
      name: this.name,
      runs: this.runs,
      actions: this.actions,
      errors: this.errors,
      lastRun: this.lastRun,
      details: {
        subscribers: String(active.length),
        aumManaged: `$${active.reduce((a, s) => a + s.lastValueUsdc, 0).toFixed(2)}`,
        cyclesRun: String(active.reduce((a, s) => a + s.cyclesRun, 0)),
      },
    };
  }
}
