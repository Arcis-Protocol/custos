import { client, ADDR, BOND_ABI, getWallet, hasWriteAccess, fmtUSDC, alert, baseSepolia } from "../config.js";
import type { Skill, SkillStats } from "../config.js";

export class BondKeeper implements Skill {
  name = "BondKeeper";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private bondsScanned = 0;
  private debtServiced = 0n;
  private serviceCount = 0;
  private deployed = false;

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    // Bond factory not yet deployed to testnet
    if (!ADDR.bondFactory) {
      if (this.runs === 1) {
        console.log("[BONDS] RevenueBondFactory not deployed. Keeper standing by.");
      }
      return;
    }

    this.deployed = true;

    try {
      const [bondCount, paused] = await Promise.all([
        client.readContract({ address: ADDR.bondFactory!, abi: BOND_ABI, functionName: "bondCount" }) as Promise<bigint>,
        client.readContract({ address: ADDR.bondFactory!, abi: BOND_ABI, functionName: "paused" }) as Promise<boolean>,
      ]);

      if (paused) {
        await alert("Bond factory is *PAUSED*.", "WARN");
        return;
      }

      const count = Number(bondCount);
      this.bondsScanned = 0;

      for (let i = 1; i <= count; i++) {
        try {
          const [escrow, revenue] = await Promise.all([
            client.readContract({ address: ADDR.bondFactory!, abi: BOND_ABI, functionName: "escrowBalances", args: [BigInt(i)] }) as Promise<bigint>,
            client.readContract({ address: ADDR.bondFactory!, abi: BOND_ABI, functionName: "totalRevenueAccumulated", args: [BigInt(i)] }) as Promise<bigint>,
          ]);

          this.bondsScanned++;

          // ── Action: Service debt when escrow has revenue ──
          if (escrow > 0n && hasWriteAccess()) {
            try {
              const wallet = getWallet()!;
              const hash = await wallet.writeContract({
                address: ADDR.bondFactory!, abi: BOND_ABI,
                functionName: "serviceDebt", args: [BigInt(i)],
                chain: baseSepolia,
              });
              const receipt = await client.waitForTransactionReceipt({ hash });
              if (receipt.status === "success") {
                this.debtServiced += escrow;
                this.serviceCount++;
                this.actions++;
                console.log(`[BONDS] Serviced debt on bond #${i}. Escrow: ${fmtUSDC(escrow)}`);
              }
            } catch (e: any) {
              // ServiceDebt may revert if no coupon due — expected
              if (!e.message?.includes("revert")) {
                this.errors++;
              }
            }
          }

          // ── Alert: Low escrow relative to revenue ──
          if (revenue > 0n && escrow === 0n) {
            await alert(
              `Bond #${i} has zero escrow but ${fmtUSDC(revenue)} accumulated revenue.\nDebt servicing may be blocked.`,
              "WARN"
            );
          }
        } catch {
          // Bond query failed
        }
      }

      console.log(`[BONDS] ${this.bondsScanned} bonds scanned | ${this.serviceCount} serviced | ${fmtUSDC(this.debtServiced)} total debt serviced`);
    } catch (e: any) {
      this.errors++;
      console.error("[BONDS] Read error:", e.message?.slice(0, 100));
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
        deployed: String(this.deployed),
        bondsScanned: String(this.bondsScanned),
        debtServiced: fmtUSDC(this.debtServiced),
        serviceCount: String(this.serviceCount),
      },
    };
  }
}
