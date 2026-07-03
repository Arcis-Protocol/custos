import { client, getWallet, hasWriteAccess, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";
import { formatEther } from "viem";

/**
 * GasSentinel — keeps CUSTOS able to act.
 *
 * Every keeper action (harvest, liquidate, service debt, rebalance) costs gas.
 * If the keeper wallet's native ETH balance runs dry, CUSTOS silently stops
 * performing on-chain work. This skill watches that balance and alerts before
 * it becomes a problem. Read-only.
 */
export class GasSentinel implements Skill {
  name = "GasSentinel";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;

  private lastBalanceWei = 0n;
  private alertedLow = false;
  private alertedCrit = false;

  // Base is cheap; keeper txs are small. Warn under 0.002 ETH, critical under 0.0005 ETH.
  private static readonly WARN_WEI = 2_000_000_000_000_000n; // 0.002 ETH
  private static readonly CRIT_WEI = 500_000_000_000_000n; // 0.0005 ETH

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      // Only meaningful when CUSTOS holds a keeper wallet.
      if (!hasWriteAccess()) {
        console.log("[GAS] monitor-only mode — no keeper wallet to watch");
        return;
      }
      const wallet = getWallet();
      const account = wallet?.account?.address;
      if (!account) return;

      const balance = (await client.getBalance({ address: account })) as bigint;
      this.lastBalanceWei = balance;

      if (balance < GasSentinel.CRIT_WEI) {
        if (!this.alertedCrit) {
          await alert(
            `Keeper wallet gas CRITICALLY low: ${formatEther(balance)} ETH. ` +
              `CUSTOS may be unable to harvest, liquidate, or service debt. Top up ${account} on Base.`,
            "CRIT"
          );
          this.alertedCrit = true;
          this.actions++;
        }
      } else if (balance < GasSentinel.WARN_WEI) {
        if (!this.alertedLow) {
          await alert(
            `Keeper wallet gas low: ${formatEther(balance)} ETH. Top up ${account} on Base soon.`,
            "WARN"
          );
          this.alertedLow = true;
          this.actions++;
        }
      } else {
        // Recovered — reset so future dips alert again.
        this.alertedLow = false;
        this.alertedCrit = false;
      }

      console.log(`[GAS] keeper balance: ${formatEther(balance)} ETH`);
    } catch (e: any) {
      this.errors++;
      console.error("[GAS] error:", e.message?.slice(0, 100));
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
        balanceEth: formatEther(this.lastBalanceWei),
        state: this.alertedCrit ? "CRITICAL" : this.alertedLow ? "LOW" : "OK",
      },
    };
  }
}
