import { client, ADDR, CREDIT_ABI, getWallet, hasWriteAccess, fmtUSDC, alert, base } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

interface LoanSnapshot {
  loanId: number;
  owed: bigint;
  lastSeen: number;
  growthRate: bigint; // bps per hour
}

export class CreditKeeper implements Skill {
  name = "CreditKeeper";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private lastUtilization = 0;
  private liquidationCount = 0;
  private loansScanned = 0;
  private unhealthyLoans: number[] = [];
  private loanHistory = new Map<number, LoanSnapshot>();

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const [pool, borrowed, loanCount, paused] = await Promise.all([
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "loanCount" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "paused" }) as Promise<boolean>,
      ]);

      // ── Alert: Credit module paused ──
      if (paused) {
        await alert("Credit module is *PAUSED*.", "WARN");
        return;
      }

      const total = pool + borrowed;
      const utilization = total > 0n ? Number(borrowed * 10000n / total) / 100 : 0;

      // ── Alert: High utilization ──
      if (utilization > 85 && utilization > this.lastUtilization) {
        await alert(
          `Credit utilization at ${utilization.toFixed(1)}%\nPool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)}\nRisk: pool may be insufficient for new loans`,
          utilization > 95 ? "CRIT" : "WARN"
        );
      }

      this.lastUtilization = utilization;

      // ── Scan all loans ──
      const count = Number(loanCount);
      this.loansScanned = 0;
      this.unhealthyLoans = [];

      for (let i = 1; i <= count; i++) {
        try {
          const owed = await client.readContract({
            address: ADDR.credit, abi: CREDIT_ABI,
            functionName: "totalOwed", args: [BigInt(i)],
          }) as bigint;

          if (owed === 0n) continue; // Repaid or doesn't exist
          this.loansScanned++;

          // Track debt growth
          const prev = this.loanHistory.get(i);
          if (prev && prev.owed > 0n) {
            const timeDelta = (Date.now() - prev.lastSeen) / 3_600_000; // hours
            if (timeDelta > 0 && owed > prev.owed) {
              const growth = Number((owed - prev.owed) * 10000n / prev.owed);
              const growthPerHour = growth / timeDelta;

              // Alert: rapid debt growth (> 1% per hour = likely defaulting)
              if (growthPerHour > 100) {
                this.unhealthyLoans.push(i);
                await alert(
                  `Loan #${i} debt growing rapidly: ${(growthPerHour / 100).toFixed(2)}%/hr\nOwed: ${fmtUSDC(owed)} (was ${fmtUSDC(prev.owed)})`,
                  "WARN"
                );
              }
            }
          }

          this.loanHistory.set(i, { loanId: i, owed, lastSeen: Date.now(), growthRate: 0n });

          // ── Action: Liquidate unhealthy loans ──
          // The credit contract's liquidate() has its own health check
          // We call it and let the contract decide if it's valid
          if (hasWriteAccess() && this.unhealthyLoans.includes(i)) {
            try {
              const wallet = getWallet()!;
              const hash = await wallet.writeContract({
                address: ADDR.credit, abi: CREDIT_ABI,
                functionName: "liquidate", args: [BigInt(i)],
                chain: base,
              });
              const receipt = await client.waitForTransactionReceipt({ hash });
              if (receipt.status === "success") {
                this.liquidationCount++;
                this.actions++;
                await alert(`Liquidated loan #${i}. Owed: ${fmtUSDC(owed)}`, "WARN");
              }
            } catch (e: any) {
              // Liquidation reverted — loan is actually healthy (contract rejected)
              // This is expected and not an error
              if (!e.message?.includes("revert")) {
                this.errors++;
              }
            }
          }
        } catch {
          // Loan query failed — may not exist
        }
      }

      console.log(`[CREDIT] Pool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)} | Util: ${utilization.toFixed(1)}% | Loans: ${this.loansScanned} active`);
    } catch (e: any) {
      this.errors++;
      console.error("[CREDIT] Read error:", e.message?.slice(0, 100));
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
        utilization: `${this.lastUtilization.toFixed(1)}%`,
        activeLoans: String(this.loansScanned),
        unhealthyLoans: String(this.unhealthyLoans.length),
        liquidations: String(this.liquidationCount),
      },
    };
  }
}
