import {
  client,
  ADDR,
  VAULT_ABI,
  FACTORY_ABI,
  CREDIT_ABI,
  fmtUSDC,
  alert,
} from "../config.js";
import type { Skill, SkillStats } from "../config.js";

/**
 * TreasuryDigest — a periodic, whole-protocol snapshot.
 *
 * Reads the flagship vault, the agent-token vault registry, and the credit
 * pool, and composes a single digest of the protocol's state. Emits it to the
 * log and (optionally) hands a compact version to the X skill on a slow cadence
 * so the timeline periodically shows real, aggregate numbers.
 */
export class TreasuryDigest implements Skill {
  name = "TreasuryDigest";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;

  private xSkill: any = null;
  private lastPostAt = 0;
  private readonly postIntervalMs = 12 * 60 * 60 * 1000; // at most twice a day

  setXSkill(x: any) {
    this.xSkill = x;
  }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const [vaultTVL, credited, borrowed, vaultCount] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
        client.readContract({ address: ADDR.factory, abi: FACTORY_ABI, functionName: "vaultCount" }) as Promise<bigint>,
      ]);

      // Sum agent-token vault TVL across the registry.
      let agentVaultTVL = 0n;
      const count = Number(vaultCount);
      for (let i = 0; i < count; i++) {
        try {
          const info = (await client.readContract({
            address: ADDR.factory,
            abi: FACTORY_ABI,
            functionName: "vaultInfo",
            args: [BigInt(i)],
          })) as any;
          const vaultAddr = info.vault ?? info[0];
          if (vaultAddr) {
            const tvl = (await client.readContract({
              address: vaultAddr,
              abi: VAULT_ABI,
              functionName: "totalAssets",
            })) as bigint;
            agentVaultTVL += tvl;
          }
        } catch {
          /* skip */
        }
      }

      const pool = credited + borrowed;
      const util = pool > 0n ? Number((borrowed * 10000n) / pool) / 100 : 0;

      const digest =
        `Arcis snapshot — ` +
        `vault TVL ${fmtUSDC(vaultTVL)}, ` +
        `${count} agent vault${count === 1 ? "" : "s"}, ` +
        `credit pool ${fmtUSDC(pool)} (${util.toFixed(1)}% used)`;

      console.log(`[DIGEST] ${digest}`);

      // ── Slow-cadence post to X ──
      const now = Date.now();
      if (this.xSkill && now - this.lastPostAt > this.postIntervalMs) {
        try {
          await this.xSkill.postAction("Treasury snapshot", digest);
          this.lastPostAt = now;
          this.actions++;
        } catch {
          /* posting is best-effort */
        }
      }
    } catch (e: any) {
      this.errors++;
      console.error("[DIGEST] error:", e.message?.slice(0, 100));
      await alert(`Treasury digest failed: ${e.message?.slice(0, 80)}`, "WARN");
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
        lastPost: this.lastPostAt ? new Date(this.lastPostAt).toISOString() : "never",
      },
    };
  }
}
