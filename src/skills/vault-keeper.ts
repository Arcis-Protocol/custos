import { client, ADDR, VAULT_ABI, getWallet, hasWriteAccess, fmtUSDC, alert, baseSepolia } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

export class VaultKeeper implements Skill {
  name = "VaultKeeper";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private lastTVL = 0n;
  private totalYieldHarvested = 0n;
  private harvestCount = 0;
  private tvlHighWaterMark = 0n;
  private consecutiveDrops = 0;

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const [totalAssets, reserve, deployed, paused, supply, rate] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "deployedBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "paused" }) as Promise<boolean>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalSupply" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
      ]);

      // ── Alert: Vault Paused ──
      if (paused) {
        await alert("Vault is *PAUSED*. All deposits and withdrawals blocked.", "CRIT");
        return;
      }

      // ── Alert: TVL Drop > 15% ──
      if (this.lastTVL > 0n && totalAssets < this.lastTVL * 85n / 100n) {
        const drop = Number((this.lastTVL - totalAssets) * 10000n / this.lastTVL) / 100;
        this.consecutiveDrops++;
        await alert(
          `TVL dropped ${drop.toFixed(1)}% (${this.consecutiveDrops} consecutive)\nPrevious: ${fmtUSDC(this.lastTVL)}\nNow: ${fmtUSDC(totalAssets)}`,
          this.consecutiveDrops >= 3 ? "CRIT" : "WARN"
        );
      } else {
        this.consecutiveDrops = 0;
      }

      // ── Alert: TVL Invariant Drift ──
      const sum = reserve + deployed;
      if (totalAssets > 0n) {
        const drift = totalAssets > sum
          ? Number((totalAssets - sum) * 10000n / totalAssets)
          : Number((sum - totalAssets) * 10000n / totalAssets);
        if (drift > 100) {
          await alert(
            `TVL invariant drift: ${(drift / 100).toFixed(2)}%\ntotalAssets: ${fmtUSDC(totalAssets)}\nreserve + deployed: ${fmtUSDC(sum)}`,
            "WARN"
          );
        }
      }

      // ── Track high water mark ──
      if (totalAssets > this.tvlHighWaterMark) {
        this.tvlHighWaterMark = totalAssets;
      }

      this.lastTVL = totalAssets;

      // ── Action: Harvest yield ──
      if (deployed > 0n && hasWriteAccess()) {
        const wallet = getWallet()!;
        try {
          const tvlBefore = totalAssets;
          const hash = await wallet.writeContract({
            address: ADDR.vault, abi: VAULT_ABI, functionName: "harvest",
            chain: baseSepolia,
          });
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status === "success") {
            // Read new TVL to calculate yield
            const tvlAfter = await client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as bigint;
            const yieldAmount = tvlAfter > tvlBefore ? tvlAfter - tvlBefore : 0n;

            this.totalYieldHarvested += yieldAmount;
            this.harvestCount++;
            this.actions++;

            if (yieldAmount > 0n) {
              console.log(`[VAULT] Harvested ${fmtUSDC(yieldAmount)} yield. TX: ${hash.slice(0, 14)}...`);
            }
          }
        } catch (e: any) {
          // Harvest reverts if no yield accrued — not an error
          if (e.message?.includes("revert") || e.message?.includes("execution reverted")) {
            // Expected — no yield to harvest
          } else {
            this.errors++;
            console.error("[VAULT] Harvest error:", e.message?.slice(0, 80));
          }
        }
      }

      const rateStr = (Number(rate) / 1e18).toFixed(6);
      console.log(`[VAULT] TVL: ${fmtUSDC(totalAssets)} | Rate: ${rateStr} | Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`);
    } catch (e: any) {
      this.errors++;
      console.error("[VAULT] Read error:", e.message?.slice(0, 100));
      await alert(`Vault keeper failed: ${e.message?.slice(0, 80)}`, "CRIT");
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
        tvl: fmtUSDC(this.lastTVL),
        tvlHighWaterMark: fmtUSDC(this.tvlHighWaterMark),
        totalYieldHarvested: fmtUSDC(this.totalYieldHarvested),
        harvestCount: String(this.harvestCount),
      },
    };
  }
}
