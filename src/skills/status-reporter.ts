import { client, ADDR, VAULT_ABI, CREDIT_ABI, fmtUSDC, fmtDuration, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

export class StatusReporter implements Skill {
  name = "StatusReporter";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private startTime = Date.now();
  private skills: Skill[] = [];

  /** Register other skills so the status report can aggregate their stats */
  registerSkills(skills: Skill[]) {
    this.skills = skills;
  }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();
    this.actions++;

    try {
      const [totalAssets, rate, supply, reserve, deployed, pool, borrowed] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalSupply" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "deployedBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
      ]);

      const total = pool + borrowed;
      const utilization = total > 0n ? Number(borrowed * 10000n / total) / 100 : 0;
      const rateStr = supply > 0n ? (Number(rate) / 1e18).toFixed(6) : "1.000000";
      const uptime = fmtDuration(Date.now() - this.startTime);

      // Aggregate skill stats
      let totalActions = 0;
      let totalErrors = 0;
      const skillLines: string[] = [];

      for (const skill of this.skills) {
        const s = skill.stats();
        totalActions += s.actions;
        totalErrors += s.errors;

        const detailStr = Object.entries(s.details)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");

        skillLines.push(`  ${s.name}: ${s.runs} runs, ${s.actions} actions${s.errors > 0 ? `, ${s.errors} errors` : ""}`);
      }

      const report = [
        `*Custos Status Report*`,
        ``,
        `*Vault*`,
        `TVL: ${fmtUSDC(totalAssets)}`,
        `Rate: ${rateStr} USDC/raUSDC`,
        `Supply: ${Number(supply).toLocaleString()} shares raUSDC`,
        `Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`,
        ``,
        `*Credit*`,
        `Pool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)}`,
        `Utilization: ${utilization.toFixed(1)}%`,
        ``,
        `*Keeper*`,
        ...skillLines,
        ``,
        `Total: ${totalActions} actions, ${totalErrors} errors`,
        `Uptime: ${uptime}`,
      ].join("\n");

      await alert(report, "INFO");

      // Log to stdout as well
      console.log(`[STATUS] TVL: ${fmtUSDC(totalAssets)} | Rate: ${rateStr} | Util: ${utilization.toFixed(1)}% | Actions: ${totalActions} | Up: ${uptime}`);
    } catch (e: any) {
      this.errors++;
      console.error("[STATUS] Report error:", e.message?.slice(0, 100));
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
        uptime: fmtDuration(Date.now() - this.startTime),
        reportsGenerated: String(this.runs),
      },
    };
  }
}
