import * as fs from "fs";
import { client, ADDR, alert, EXPLORER, VAULT_ABI } from "../config.js";
import type { Skill, SkillStats } from "../config.js";
import type { XSkill } from "./x-skill.js";

/**
 * ProofSkill — the proof cadence.
 *
 * Turns CUSTOS into a running highlight reel of an agent actually working.
 * It watches ONLY real, on-chain-verifiable facts (vault TVL) and announces the
 * newsworthy ones: a TVL milestone crossed, or a meaningful new deposit. Every
 * post carries a BaseScan link so any claim can be checked. No price talk, ever.
 *
 * Safety, because a wrong public number would hurt a proof-first brand:
 *   - OFF by default (PROOF_ENABLED=false).
 *   - Defaults to "telegram" mode — drafts land in your operator chat so you can
 *     see what it WOULD post. Flip PROOF_MODE=x to auto-post to X once you trust it.
 *   - Rate-limited (min hours between posts, max per day), deposit threshold to
 *     ignore yield noise, and milestone de-dup so nothing is announced twice.
 *   - On first run it baselines silently — it never posts stale history on enable.
 */

const num = (k: string, d: number) => { const v = process.env[k]; const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };
const bool = (k: string, d: boolean) => { const v = process.env[k]; if (v == null || v === "") return d; return /^(1|true|yes|on)$/i.test(v); };
const STATE = process.env.PROOF_STATE_PATH || "./.proof-state.json";

interface ProofState { lastTvl: number; posted: number[]; lastPostAt: number; dayKey: string; dayCount: number; posts: number; }

export class ProofSkill implements Skill {
  name = "ProofSkill";
  private runs = 0; private actions = 0; private errors = 0; private lastRun = 0;

  private enabled = bool("PROOF_ENABLED", false);
  private mode = (process.env.PROOF_MODE || "telegram").toLowerCase();
  private minDeposit = num("PROOF_MIN_DEPOSIT_USDC", 100);
  private minHours = num("PROOF_MIN_HOURS_BETWEEN", 6);
  private maxPerDay = num("PROOF_MAX_PER_DAY", 4);
  private milestones = (process.env.PROOF_MILESTONES || "1000,5000,10000,25000,50000,100000,250000,500000,1000000")
    .split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n)).sort((a, b) => a - b);

  constructor(private xSkill: XSkill) {}

  private load(): ProofState { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { lastTvl: -1, posted: [], lastPostAt: 0, dayKey: "", dayCount: 0, posts: 0 }; } }
  private save(s: ProofState) { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch {} }

  async run(): Promise<void> {
    this.runs++; this.lastRun = Date.now();
    if (!this.enabled) return;

    try {
      const totalAssets = await client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as bigint;
      const tvl = Number(totalAssets) / 1e6;
      const s = this.load();

      // First run: baseline silently, mark already-achieved milestones as posted.
      if (s.lastTvl < 0) {
        s.lastTvl = tvl;
        s.posted = this.milestones.filter(m => tvl >= m);
        this.save(s);
        return;
      }

      // Rate limits.
      const today = new Date().toISOString().slice(0, 10);
      if (s.dayKey !== today) { s.dayKey = today; s.dayCount = 0; }
      const canPost = (Date.now() - s.lastPostAt) / 3_600_000 >= this.minHours && s.dayCount < this.maxPerDay;

      // Pick the single most newsworthy event this cycle.
      let text: string | null = null;
      let markMilestones: number[] = [];
      const crossed = this.milestones.filter(m => tvl >= m && !s.posted.includes(m));
      if (crossed.length) {
        const m = Math.max(...crossed);
        markMilestones = crossed;
        text = `🏛️ Proof of work.\n\nThe Arcis vault just crossed $${m.toLocaleString()} in deposits — real USDC, working on-chain.\n\nEvery dollar verifiable:\n${EXPLORER}/address/${ADDR.vault}\n\nWe don't promise price. We post proof.`;
      } else {
        const delta = tvl - s.lastTvl;
        if (delta >= this.minDeposit) {
          text = `🏛️ Capital in motion.\n\n+$${Math.round(delta).toLocaleString()} USDC just deposited into the Arcis vault. TVL now $${Math.round(tvl).toLocaleString()}.\n\nIdle money, put to work — on-chain, verifiable.\n${EXPLORER}/address/${ADDR.vault}`;
        }
      }

      if (text && canPost) {
        if (this.mode === "x") {
          const ok = await this.xSkill.postProof(text);
          await alert(ok ? `📣 Proof posted to X:\n\n${text}` : `Proof (X unavailable) — draft:\n\n${text}`, "INFO");
        } else {
          await alert(`*Proof cadence draft* (set PROOF_MODE=x to auto-post to X):\n\n${text}`, "INFO");
        }
        markMilestones.forEach(m => s.posted.push(m));
        this.actions++; s.posts++; s.lastPostAt = Date.now(); s.dayCount++;
      }

      s.lastTvl = tvl;
      this.save(s);
    } catch (e: any) { this.errors++; }
  }

  stats(): SkillStats {
    const s = this.load();
    return {
      name: this.name, runs: this.runs, actions: this.actions, errors: this.errors, lastRun: this.lastRun,
      details: { enabled: String(this.enabled), mode: this.mode, posts: String(s.posts || 0) },
    };
  }
}
