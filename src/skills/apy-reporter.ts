import { client, ADDR, VAULT_ABI, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

/**
 * APYReporter — tracks the vault's realized APY over time.
 *
 * Estimates APY from the vault exchange-rate delta between runs (annualized),
 * keeps a rolling picture, and alerts when the realized rate drops sharply or
 * goes negative (which would signal a strategy problem). This is the source of
 * truth for "what is the vault actually earning right now" — no hardcoded rate.
 */
export class APYReporter implements Skill {
  name = "APYReporter";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;

  private lastRate = 0n;
  private lastRateAt = 0;
  private currentApyPct = 0;
  private emaApyPct = 0; // exponential moving average, smooths noise
  private samples = 0;

  private static readonly WAD = 1_000_000_000_000_000_000n;
  private static readonly YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  private static readonly EMA_ALPHA = 0.2;

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const rate = (await client.readContract({
        address: ADDR.vault,
        abi: VAULT_ABI,
        functionName: "exchangeRate",
      })) as bigint;

      const now = Date.now();

      if (this.lastRate > 0n && this.lastRateAt > 0) {
        const dtMs = now - this.lastRateAt;
        if (dtMs > 0 && rate !== this.lastRate) {
          // Fractional growth over the interval, in floating point.
          const growth =
            Number(((rate - this.lastRate) * APYReporter.WAD) / this.lastRate) /
            Number(APYReporter.WAD);
          // Annualize linearly (simple APR-style figure; good enough for monitoring).
          const annualized = (growth * APYReporter.YEAR_MS) / dtMs;
          this.currentApyPct = annualized * 100;

          this.samples++;
          this.emaApyPct =
            this.samples === 1
              ? this.currentApyPct
              : APYReporter.EMA_ALPHA * this.currentApyPct +
                (1 - APYReporter.EMA_ALPHA) * this.emaApyPct;

          // ── Alert: negative realized rate (rate went down) ──
          if (this.currentApyPct < 0) {
            await alert(
              `Vault exchange rate DECREASED — realized APY negative this interval (${this.currentApyPct.toFixed(2)}%). Possible strategy loss; investigate.`,
              "WARN"
            );
            this.actions++;
          }
        }
      }

      this.lastRate = rate;
      this.lastRateAt = now;

      console.log(
        `[APY] interval: ${this.currentApyPct.toFixed(2)}% | smoothed: ${this.emaApyPct.toFixed(2)}% | samples: ${this.samples}`
      );
    } catch (e: any) {
      this.errors++;
      console.error("[APY] error:", e.message?.slice(0, 100));
    }
  }

  /** Current smoothed APY estimate as a percentage (e.g. 2.14). */
  get apyPct(): number {
    return this.emaApyPct;
  }

  stats(): SkillStats {
    return {
      name: this.name,
      runs: this.runs,
      actions: this.actions,
      errors: this.errors,
      lastRun: this.lastRun,
      details: {
        intervalApy: `${this.currentApyPct.toFixed(2)}%`,
        smoothedApy: `${this.emaApyPct.toFixed(2)}%`,
        samples: String(this.samples),
      },
    };
  }
}
