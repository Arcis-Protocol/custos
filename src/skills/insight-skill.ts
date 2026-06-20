import { client, ADDR, VAULT_ABI, CREDIT_ABI, fmtUSDC, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

// ═══════════════════════════════════════════════════
//  INSIGHT SKILL — Protocol Intelligence & Education
//
//  Generates data-driven insights about the protocol
//  and the broader AI agent economy. Posts educational
//  content that establishes Arcis as a thought leader.
//  Never speculative. Always grounded in data.
// ═══════════════════════════════════════════════════

interface ProtocolSnapshot {
  tvl: bigint;
  rate: bigint;
  pool: bigint;
  borrowed: bigint;
  utilization: number;
  timestamp: number;
}

export class InsightSkill implements Skill {
  name = "InsightSkill";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private snapshots: ProtocolSnapshot[] = [];
  private insightsGenerated = 0;
  private xSkill: any = null;
  private telegramChatId = process.env.TELEGRAM_CHAT_ID || "";

  setXSkill(x: any) { this.xSkill = x; }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      // Take a protocol snapshot
      const [totalAssets, rate, pool, borrowed] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
      ]);

      const total = pool + borrowed;
      const utilization = total > 0n ? Number(borrowed * 10000n / total) / 100 : 0;

      const snapshot: ProtocolSnapshot = { tvl: totalAssets, rate, pool, borrowed, utilization, timestamp: Date.now() };
      this.snapshots.push(snapshot);

      // Keep last 168 snapshots (7 days at 1/hour)
      if (this.snapshots.length > 168) this.snapshots.shift();

      // Generate insight if enough data
      if (this.snapshots.length >= 2) {
        const insight = this.generateInsight(snapshot);
        if (insight) {
          await alert(`*Insight*\n\n${insight}`, "INFO");
          if (this.xSkill) await this.xSkill.postAction("Insight", insight);
          this.insightsGenerated++;
          this.actions++;
        }
      }
    } catch (e: any) {
      this.errors++;
    }
  }

  private generateInsight(current: ProtocolSnapshot): string | null {
    const prev = this.snapshots[this.snapshots.length - 2];
    if (!prev) return null;

    // Only generate an insight if something meaningful changed
    const insights: string[] = [];

    // TVL trend
    if (current.tvl > prev.tvl) {
      const growthPct = Number((current.tvl - prev.tvl) * 10000n / prev.tvl) / 100;
      if (growthPct > 1) {
        insights.push(`Vault TVL grew ${growthPct.toFixed(1)}% since last snapshot. ${fmtUSDC(current.tvl)} total.`);
      }
    } else if (current.tvl < prev.tvl && prev.tvl > 0n) {
      const dropPct = Number((prev.tvl - current.tvl) * 10000n / prev.tvl) / 100;
      if (dropPct > 1) {
        insights.push(`Vault TVL decreased ${dropPct.toFixed(1)}%. ${fmtUSDC(current.tvl)} remaining.`);
      }
    }

    // Exchange rate movement (yield accrual)
    if (current.rate > prev.rate) {
      const rateGrowth = Number((current.rate - prev.rate) * 10000n / prev.rate) / 100;
      if (rateGrowth > 0.01) {
        insights.push(`Exchange rate increased ${rateGrowth.toFixed(4)}%. raUSDC holders earning yield.`);
      }
    }

    // Utilization shifts
    if (current.utilization > prev.utilization + 5) {
      insights.push(`Credit utilization rose to ${current.utilization.toFixed(1)}%. Borrowing demand increasing.`);
    } else if (current.utilization < prev.utilization - 5) {
      insights.push(`Credit utilization fell to ${current.utilization.toFixed(1)}%. Loans being repaid.`);
    }

    // Educational insights (rotate through on quiet periods)
    if (insights.length === 0 && this.runs % 6 === 0) {
      return this.educationalInsight();
    }

    return insights.length > 0 ? insights[0] : null;
  }

  private educationalInsight(): string {
    const lessons = [
      "The ATI standard defines three functions: deposit, withdraw, balance. Any agent framework that can call a smart contract can use Arcis. No SDK required. No API key. No rate limit.",
      "raUSDC is a yield-bearing receipt token. It represents a claim on vault assets. As strategies earn yield, the exchange rate increases — your raUSDC buys more USDC over time.",
      "ERC-8004 identity tiers let agents with proven track records borrow at lower collateral ratios. Reputation earned on-chain, not granted by committees.",
      "Revenue bonds let agents with proven revenue streams raise capital from human investors. The smart contract enforces coupon payments before agent profits.",
      "CUSTOS is not a chatbot. It's a keeper — an autonomous agent that performs protocol maintenance. Harvesting yield, liquidating unhealthy loans, servicing bond debt.",
      "The vault uses a strategy allocator to distribute capital across multiple yield sources. No single-strategy risk. Diversification enforced at the contract level.",
      "Agent credit lines are undercollateralized for high-reputation agents. Tier IV (Elite) agents can borrow at 110% collateral — 90% less than Tier 0.",
      "Every deposit and withdrawal is a single function call. No multi-step approval flows. No wallet pop-ups. Built for machines operating at machine speed.",
    ];
    return lessons[this.runs % lessons.length];
  }

  stats(): SkillStats {
    return {
      name: this.name, runs: this.runs, actions: this.actions,
      errors: this.errors, lastRun: this.lastRun,
      details: {
        snapshotsStored: String(this.snapshots.length),
        insightsGenerated: String(this.insightsGenerated),
      },
    };
  }
}
