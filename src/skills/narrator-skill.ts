import { fmtUSDC, alert } from "../config.js";
import * as voice from "../social/voice.js";
import type { Skill, SkillStats } from "../config.js";

// ═══════════════════════════════════════════════════
//  NARRATOR SKILL — Real-time Keeper Narration
//
//  Listens to keeper skill outputs and narrates
//  significant actions across Telegram and X.
//  Not every action gets narrated — only events
//  worth the community's attention.
// ═══════════════════════════════════════════════════

interface KeeperEvent {
  skill: string;
  action: string;
  detail: string;
  value?: bigint;
  timestamp: number;
}

export class NarratorSkill implements Skill {
  name = "NarratorSkill";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private eventQueue: KeeperEvent[] = [];
  private narrationCount = 0;
  private telegramChatId = process.env.TELEGRAM_CHAT_ID || "";
  private xSkill: any = null;

  /** Wire up the X skill for cross-posting */
  setXSkill(x: any) { this.xSkill = x; }

  /** Other skills push events here */
  pushEvent(event: KeeperEvent) {
    this.eventQueue.push(event);
  }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    if (this.eventQueue.length === 0) return;

    // Process queued events
    const events = [...this.eventQueue];
    this.eventQueue = [];

    for (const event of events) {
      const narration = this.compose(event);
      if (!narration) continue;

      // Post to Telegram
      await alert(narration, "INFO");

      // Post significant events to X
      if (this.isSignificant(event) && this.xSkill) {
        await this.xSkill.postAction(event.action, event.detail);
      }

      this.narrationCount++;
      this.actions++;
    }
  }

  private compose(event: KeeperEvent): string | null {
    switch (event.action) {
      case "harvest":
        return `Harvested ${event.detail}. The citadel compounds.`;

      case "liquidate":
        return `Liquidated loan. ${event.detail}. Protocol health preserved.`;

      case "serviceDebt":
        return `Bond debt serviced. ${event.detail}. Obligations met.`;

      case "tvl_drop":
        return `TVL declined. ${event.detail}. Monitoring.`;

      case "tvl_recovery":
        return `TVL recovered. ${event.detail}. Citadel stands.`;

      case "high_utilization":
        return `Credit utilization elevated. ${event.detail}. Watching.`;

      case "vault_paused":
        return `Vault paused. Operations suspended. Awaiting governance.`;

      case "new_high":
        return `New TVL high water mark: ${event.detail}. The citadel grows.`;

      default:
        return null; // Don't narrate routine events
    }
  }

  private isSignificant(event: KeeperEvent): boolean {
    // Only post to X for truly notable events
    const significant = ["harvest", "liquidate", "serviceDebt", "new_high", "tvl_drop"];
    return significant.includes(event.action);
  }

  stats(): SkillStats {
    return {
      name: this.name, runs: this.runs, actions: this.actions,
      errors: this.errors, lastRun: this.lastRun,
      details: {
        narrations: String(this.narrationCount),
        queuedEvents: String(this.eventQueue.length),
      },
    };
  }
}
