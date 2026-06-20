import { ADDR, hasWriteAccess, alert } from "./config.js";
import { VaultKeeper } from "./skills/vault-keeper.js";
import { CreditKeeper } from "./skills/credit-keeper.js";
import { BondKeeper } from "./skills/bond-keeper.js";
import { StatusReporter } from "./skills/status-reporter.js";

// ═══════════════════════════════════════════════════
//  CUSTOS — The Keeper of the Citadel
//  Autonomous DeFi agent for Arcis Protocol
// ═══════════════════════════════════════════════════

// ── Intervals ──
const VAULT_INTERVAL = 300_000;    // 5 min
const CREDIT_INTERVAL = 60_000;    // 1 min
const BOND_INTERVAL = 600_000;     // 10 min
const STATUS_INTERVAL = 3_600_000; // 1 hour

// ── Skills ──
const vaultKeeper = new VaultKeeper();
const creditKeeper = new CreditKeeper();
const bondKeeper = new BondKeeper();
const statusReporter = new StatusReporter();

// Register all skills for aggregated status reports
statusReporter.registerSkills([vaultKeeper, creditKeeper, bondKeeper, statusReporter]);

// ── Graceful Shutdown ──
let running = true;

process.on("SIGINT", async () => {
  console.log("\n[CUSTOS] Shutting down...");
  running = false;

  // Final status report
  await statusReporter.run();
  await alert("CUSTOS shutting down. The keeper rests.", "INFO");
  process.exit(0);
});

process.on("SIGTERM", () => {
  running = false;
  process.exit(0);
});

// ── Main ──
async function main() {
  console.log("");
  console.log("  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("  \u2551   C U S T O S                        \u2551");
  console.log("  \u2551   The Keeper of the Citadel           \u2551");
  console.log("  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log("");
  console.log(`  Vault:      ${ADDR.vault}`);
  console.log(`  Credit:     ${ADDR.credit}`);
  console.log(`  Bonds:      ${ADDR.bondFactory || "not deployed"}`);
  console.log(`  Mode:       ${hasWriteAccess() ? "KEEPER (read + write)" : "MONITOR (read-only)"}`);
  console.log(`  Telegram:   ${process.env.TELEGRAM_BOT_TOKEN ? "configured" : "stdout only"}`);
  console.log("");
  console.log("  Skills:");
  console.log(`    VaultKeeper     every ${VAULT_INTERVAL / 1000}s   harvest, rebalance, TVL`);
  console.log(`    CreditKeeper    every ${CREDIT_INTERVAL / 1000}s    loans, liquidation, utilization`);
  console.log(`    BondKeeper      every ${BOND_INTERVAL / 1000}s  serviceDebt, depositPrincipal`);
  console.log(`    StatusReporter  every ${STATUS_INTERVAL / 1000}s protocol summary`);
  console.log("");

  // Initial run of all skills
  await vaultKeeper.run();
  await creditKeeper.run();
  await bondKeeper.run();
  await statusReporter.run();

  // Start keeper loops
  const intervals = [
    setInterval(() => vaultKeeper.run(), VAULT_INTERVAL),
    setInterval(() => creditKeeper.run(), CREDIT_INTERVAL),
    setInterval(() => bondKeeper.run(), BOND_INTERVAL),
    setInterval(() => statusReporter.run(), STATUS_INTERVAL),
  ];

  await alert(
    `CUSTOS online.\nMode: ${hasWriteAccess() ? "KEEPER" : "MONITOR"}\nSkills: VaultKeeper, CreditKeeper, BondKeeper, StatusReporter`,
    "INFO"
  );

  console.log("  Custos is watching. Press Ctrl+C to stop.\n");
}

main().catch(async (e) => {
  console.error("[CUSTOS] Fatal:", e);
  await alert(`CUSTOS fatal error: ${e.message?.slice(0, 100)}`, "CRIT");
  process.exit(1);
});
