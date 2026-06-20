import { client, ADDR, VAULT_ABI, CREDIT_ABI, fmtUSDC, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

// ═══════════════════════════════════════════════════
//  ENGAGEMENT SKILL — Community Growth & Milestones
//
//  Tracks protocol growth metrics and celebrates
//  milestones. Welcomes new community members.
//  Monitors vault depositor count and TVL targets.
// ═══════════════════════════════════════════════════

const TVL_MILESTONES = [
  10_000n, 25_000n, 50_000n, 100_000n, 250_000n,
  500_000n, 1_000_000n, 5_000_000n, 10_000_000n,
].map(n => n * 1_000_000n); // Convert to USDC decimals

export class EngagementSkill implements Skill {
  name = "EngagementSkill";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private milestonesHit = new Set<string>();
  private highestTVL = 0n;
  private dailySummaryHour = -1;
  private xSkill: any = null;

  setXSkill(x: any) { this.xSkill = x; }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const tvl = await client.readContract({
        address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets",
      }) as bigint;

      // ── TVL Milestones ──
      for (const milestone of TVL_MILESTONES) {
        const key = milestone.toString();
        if (tvl >= milestone && !this.milestonesHit.has(key)) {
          this.milestonesHit.add(key);
          const label = fmtUSDC(milestone);
          const msg = `The citadel crossed ${label} TVL.\n\n${fmtUSDC(tvl)} total assets secured.`;
          await alert(msg, "INFO");
          if (this.xSkill) await this.xSkill.postAction("Milestone", msg);
          this.actions++;
        }
      }

      // ── New ATH ──
      if (tvl > this.highestTVL && this.highestTVL > 0n) {
        const growth = Number((tvl - this.highestTVL) * 10000n / this.highestTVL) / 100;
        if (growth > 5) { // Only celebrate >5% new ATH
          const msg = `New all-time high: ${fmtUSDC(tvl)}. Previous: ${fmtUSDC(this.highestTVL)}.`;
          await alert(msg, "INFO");
          this.actions++;
        }
      }
      if (tvl > this.highestTVL) this.highestTVL = tvl;

      // ── Daily Summary (once per day at hour 9 UTC) ──
      const hour = new Date().getUTCHours();
      if (hour === 9 && this.dailySummaryHour !== 9) {
        this.dailySummaryHour = 9;
        await this.postDailySummary(tvl);
      }
      if (hour !== 9) this.dailySummaryHour = -1;

    } catch (e: any) {
      this.errors++;
    }
  }

  private async postDailySummary(tvl: bigint) {
    const [pool, borrowed] = await Promise.all([
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
    ]);
    const total = pool + borrowed;
    const util = total > 0n ? (Number(borrowed * 10000n / total) / 100).toFixed(1) : "0.0";

    const summary = [
      `Daily briefing.`,
      ``,
      `TVL: ${fmtUSDC(tvl)}`,
      `ATH: ${fmtUSDC(this.highestTVL)}`,
      `Credit util: ${util}%`,
      `Milestones: ${this.milestonesHit.size} reached`,
      ``,
      `The citadel stands.`,
    ].join("\n");

    await alert(summary, "INFO");
    if (this.xSkill) await this.xSkill.postAction("Daily", summary);
    this.actions++;
  }

  stats(): SkillStats {
    return {
      name: this.name, runs: this.runs, actions: this.actions,
      errors: this.errors, lastRun: this.lastRun,
      details: {
        tvlATH: fmtUSDC(this.highestTVL),
        milestonesReached: String(this.milestonesHit.size),
      },
    };
  }
}
