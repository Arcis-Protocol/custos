import { client, ADDR, FACTORY_ABI, VAULT_ABI, fmtUSDC, fmtAddr, alert } from "../config.js";
import type { Skill, SkillStats } from "../config.js";
import type { Address } from "viem";

/**
 * VaultFactoryKeeper — watches the agent-token vault registry.
 *
 * CUSTOS operates a factory of agent-token vaults (e.g. raCUSTOS). This skill
 * keeps the keeper aware of them: it detects newly created vaults, tracks each
 * vault's TVL and pause state, and alerts on new vaults or paused vaults.
 */
export class VaultFactoryKeeper implements Skill {
  name = "VaultFactoryKeeper";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;

  private knownVaults = new Set<string>();
  private lastVaultCount = 0;
  private pausedVaults = new Set<string>();

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    try {
      const count = Number(
        (await client.readContract({
          address: ADDR.factory,
          abi: FACTORY_ABI,
          functionName: "vaultCount",
        })) as bigint
      );

      // ── Detect new vaults ──
      if (this.lastVaultCount > 0 && count > this.lastVaultCount) {
        const added = count - this.lastVaultCount;
        await alert(
          `${added} new agent-token vault${added > 1 ? "s" : ""} created via the factory. Registry now holds ${count}.`,
          "INFO"
        );
        this.actions++;
      }
      this.lastVaultCount = count;

      // ── Walk the registry ──
      let totalAcrossVaults = 0n;
      for (let i = 0; i < count; i++) {
        try {
          const info = (await client.readContract({
            address: ADDR.factory,
            abi: FACTORY_ABI,
            functionName: "vaultInfo",
            args: [BigInt(i)],
          })) as any;

          // vaultInfo returns a tuple; normalize common shapes.
          const vaultAddr = (info.vault ?? info[0]) as Address;
          const symbol = (info.symbol ?? info[3] ?? "?") as string;

          if (vaultAddr && !this.knownVaults.has(vaultAddr.toLowerCase())) {
            this.knownVaults.add(vaultAddr.toLowerCase());
          }

          const [totalAssets, paused] = await Promise.all([
            client.readContract({ address: vaultAddr, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
            client.readContract({ address: vaultAddr, abi: VAULT_ABI, functionName: "paused" }) as Promise<boolean>,
          ]);

          totalAcrossVaults += totalAssets;

          // ── Alert: a vault became paused ──
          const key = vaultAddr.toLowerCase();
          if (paused && !this.pausedVaults.has(key)) {
            this.pausedVaults.add(key);
            await alert(`Agent vault ${symbol} (${fmtAddr(vaultAddr)}) is now *PAUSED*.`, "WARN");
          } else if (!paused && this.pausedVaults.has(key)) {
            this.pausedVaults.delete(key);
            await alert(`Agent vault ${symbol} (${fmtAddr(vaultAddr)}) is active again.`, "INFO");
          }
        } catch {
          // Skip a vault that fails to read this cycle; try again next run.
        }
      }

      console.log(
        `[FACTORY] Vaults: ${count} | tracked: ${this.knownVaults.size} | combined TVL: ${fmtUSDC(totalAcrossVaults)}`
      );
    } catch (e: any) {
      this.errors++;
      console.error("[FACTORY] error:", e.message?.slice(0, 100));
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
        vaultCount: String(this.lastVaultCount),
        trackedVaults: String(this.knownVaults.size),
        pausedVaults: String(this.pausedVaults.size),
      },
    };
  }
}
