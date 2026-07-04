// ═══════════════════════════════════════════════════════════════════════════
//  ACPTreasuryRouter — closes the Path B loop on the keeper cadence.
//
//  Watches the agent wallet's USDC (ACP earnings) and routes cleared balances
//  into the raUSDC vault, building AgentCredit capacity. Reports what it built.
//  Dry-run + disabled by default; live requires the agent wallet in Unrestricted
//  signer mode (Arcis vault is a non-Virtuals contract). See ACP.md.
// ═══════════════════════════════════════════════════════════════════════════

import { type Skill, type SkillStats, alert } from "../config.js";
import * as bridge from "../acp/bridge.js";

export class ACPTreasuryRouter implements Skill {
  name = "ACPTreasuryRouter";
  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private lastRatioPct = 0;
  private lastShares = 0;

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();
    try {
      const r = await bridge.routeEarnings();
      this.lastRatioPct = r.ratioPct;
      this.lastShares = r.raUsdcShares;
      if (r.action === "deposit") {
        this.actions++;
        const tag = r.dryRun ? "DRY RUN" : "LIVE";
        const lines = [
          `*ACP → Arcis* — ${tag}`,
          "",
          r.dryRun
            ? (r.reason || `would deposit ${r.deposited.toFixed(2)} USDC`)
            : `Routed *${r.deposited.toFixed(2)} USDC* → *${r.sharesReceived.toFixed(2)} raUSDC*`,
          r.depositTx ? bridge.bridgeTxUrl(r.depositTx) : "",
          "",
          `Credit ratio: ${r.ratioPct}% · raUSDC collateral: ${r.raUsdcShares.toFixed(2)}`,
        ].filter(Boolean);
        await alert(lines.join("\n"), "INFO");
      }
      // "skip" cycles stay silent.
    } catch (e: any) {
      this.errors++;
      await alert(`ACPTreasuryRouter error: ${e.message?.slice(0, 120)}`, "WARN");
    }
  }

  stats(): SkillStats {
    return {
      name: this.name,
      runs: this.runs,
      actions: this.actions,
      errors: this.errors,
      lastRun: this.lastRun,
      details: {
        mode: !bridge.BRIDGE.enabled ? "disabled" : bridge.BRIDGE.dryRun ? "dry-run" : "live",
        creditRatioPct: String(this.lastRatioPct),
        raUsdcCollateral: this.lastShares.toFixed(2),
      },
    };
  }
}
