import { client, ADDR, VAULT_ABI, fmtUSDC, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

/**
 * ReserveHealthKeeper — protects the instant-withdrawal guarantee.
 *
 * The vault keeps a liquid reserve (target ~30%) so agents can withdraw
 * instantly without waiting on an Aave unwind. This skill watches the realized
 * reserve ratio and alerts if it falls toward a level where a large withdrawal
 * could exceed available liquidity. Read-only — it observes, it does not move
 * funds (rebalancing is the vault keeper's job).
 */
export class ReserveHealthKeeper implements Skill {
  name = "ReserveHealthKeeper";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;

  private lastRatioBps = 0; // basis points (10000 = 100%)
  private lowSince = 0;

  // Target reserve is ~30%. Warn under 15%, critical under 8%.
  private static readonly WARN_BPS = 1500;
  private static readonly CRIT_BPS = 800;

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const [totalAssets, reserve, deployed] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "deployedBalance" }) as Promise<bigint>,
      ]);

      if (totalAssets === 0n) {
        console.log("[RESERVE] vault empty — nothing to guard");
        return;
      }

      const ratioBps = Number((reserve * 10000n) / totalAssets);
      this.lastRatioBps = ratioBps;

      if (ratioBps < ReserveHealthKeeper.CRIT_BPS) {
        if (this.lowSince === 0) this.lowSince = Date.now();
        await alert(
          `Vault reserve critically low: ${(ratioBps / 100).toFixed(1)}% liquid ` +
            `(${fmtUSDC(reserve)} of ${fmtUSDC(totalAssets)}). Large withdrawals may need an Aave unwind. ` +
            `Consider rebalancing toward the reserve target.`,
          "CRIT"
        );
        this.actions++;
      } else if (ratioBps < ReserveHealthKeeper.WARN_BPS) {
        if (this.lowSince === 0) this.lowSince = Date.now();
        await alert(
          `Vault reserve below target: ${(ratioBps / 100).toFixed(1)}% liquid ` +
            `(${fmtUSDC(reserve)} of ${fmtUSDC(totalAssets)}).`,
          "WARN"
        );
        this.actions++;
      } else {
        this.lowSince = 0;
      }

      console.log(
        `[RESERVE] ${(ratioBps / 100).toFixed(1)}% liquid | reserve ${fmtUSDC(reserve)} | deployed ${fmtUSDC(deployed)}`
      );
    } catch (e: any) {
      this.errors++;
      console.error("[RESERVE] error:", e.message?.slice(0, 100));
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
        reserveRatio: `${(this.lastRatioBps / 100).toFixed(1)}%`,
        lowSince: this.lowSince ? new Date(this.lowSince).toISOString() : "healthy",
      },
    };
  }
}
