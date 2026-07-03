import { client, ADDR, VAULT_ABI, FACTORY_ABI, fmtAddr, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";
import type { Address } from "viem";

/**
 * PeerRegistryKeeper — the discovery beacon for "treasury for all agents".
 *
 * The Agent Treasury Interface (ATI) is an open standard: any vault exposing
 * asset()/totalAssets()/balance() is ATI-compliant. This skill maintains a
 * live view of ATI-compliant vaults CUSTOS knows about — the protocol's own
 * factory vaults plus any peer addresses supplied via ATI_PEERS (comma-
 * separated) — probes each for compliance, and emits a periodic beacon of how
 * many compliant treasuries exist. It is read-only and non-custodial: it
 * observes the standard spreading, it does not touch peer funds.
 */
export class PeerRegistryKeeper implements Skill {
  name = "PeerRegistryKeeper";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;

  private compliant = new Set<string>();
  private nonCompliant = new Set<string>();
  private peers: Address[];

  constructor() {
    // Optional operator-supplied peer vaults to include in the beacon.
    this.peers = (process.env.ATI_PEERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s)) as Address[];
  }

  /** Probe an address for ATI compliance via its read surface. */
  private async isAtiCompliant(addr: Address): Promise<boolean> {
    try {
      // A compliant vault answers the core ATI reads without reverting.
      await Promise.all([
        client.readContract({ address: addr, abi: VAULT_ABI, functionName: "totalAssets" }),
        client.readContract({ address: addr, abi: VAULT_ABI, functionName: "totalSupply" }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const candidates: Address[] = [ADDR.vault];

      // Pull the factory's own vault registry.
      try {
        const count = Number(
          (await client.readContract({
            address: ADDR.factory,
            abi: FACTORY_ABI,
            functionName: "vaultCount",
          })) as bigint
        );
        for (let i = 0; i < count; i++) {
          try {
            const info = (await client.readContract({
              address: ADDR.factory,
              abi: FACTORY_ABI,
              functionName: "vaultInfo",
              args: [BigInt(i)],
            })) as any;
            const v = (info.vault ?? info[0]) as Address;
            if (v) candidates.push(v);
          } catch {
            /* skip */
          }
        }
      } catch {
        /* factory unreadable this cycle */
      }

      // Include operator-supplied peers.
      candidates.push(...this.peers);

      // De-dupe and probe.
      const seen = new Set<string>();
      let newlyCompliant = 0;
      for (const addr of candidates) {
        const key = addr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const ok = await this.isAtiCompliant(addr);
        if (ok) {
          if (!this.compliant.has(key)) {
            this.compliant.add(key);
            this.nonCompliant.delete(key);
            newlyCompliant++;
          }
        } else {
          if (!this.nonCompliant.has(key) && this.peers.some((p) => p.toLowerCase() === key)) {
            // Only surface non-compliance for explicitly supplied peers.
            this.nonCompliant.add(key);
            await alert(`Peer ${fmtAddr(addr)} is not ATI-compliant (totalAssets/totalSupply probe failed).`, "INFO");
          }
        }
      }

      if (newlyCompliant > 0) {
        this.actions++;
        console.log(`[PEERS] +${newlyCompliant} ATI-compliant vault(s) discovered`);
      }

      // Beacon.
      console.log(
        `[PEERS] ATI beacon — ${this.compliant.size} compliant treasur${this.compliant.size === 1 ? "y" : "ies"} tracked` +
          (this.peers.length ? ` (${this.peers.length} peer${this.peers.length === 1 ? "" : "s"} supplied)` : "")
      );
    } catch (e: any) {
      this.errors++;
      console.error("[PEERS] error:", e.message?.slice(0, 100));
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
        compliantVaults: String(this.compliant.size),
        peersSupplied: String(this.peers.length),
      },
    };
  }
}
