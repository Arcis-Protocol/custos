#!/usr/bin/env node

import { ADDR, hasWriteAccess, alert } from "./config.js";

// Keeper Skills
import { VaultKeeper } from "./skills/vault-keeper.js";
import { CreditKeeper } from "./skills/credit-keeper.js";
import { BondKeeper } from "./skills/bond-keeper.js";
import { StatusReporter } from "./skills/status-reporter.js";
import { VaultFactoryKeeper } from "./skills/vault-factory-keeper.js";
import { APYReporter } from "./skills/apy-reporter.js";
import { TreasuryDigest } from "./skills/treasury-digest.js";
import { ReserveHealthKeeper } from "./skills/reserve-health-keeper.js";
import { GasSentinel } from "./skills/gas-sentinel.js";
import { PeerRegistryKeeper } from "./skills/peer-registry-keeper.js";
import { TreasuryAccumulator } from "./skills/treasury-accumulator.js";
import { ACPTreasuryRouter } from "./skills/acp-treasury-router.js";

// Social Skills
import { TelegramSkill } from "./skills/telegram-skill.js";
import { XSkill } from "./skills/x-skill.js";
import { NarratorSkill } from "./skills/narrator-skill.js";
import { InsightSkill } from "./skills/insight-skill.js";
import { EngagementSkill } from "./skills/engagement-skill.js";
import { ProofSkill } from "./skills/proof-skill.js";

// ═══════════════════════════════════════════════════
//  CUSTOS — The Keeper of the Citadel
//  17 Skills. Autonomous protocol agent.
// ═══════════════════════════════════════════════════

// ── Intervals ──
const VAULT_INT = 300_000;      // 5 min
const CREDIT_INT = 60_000;      // 1 min
const BOND_INT = 600_000;       // 10 min
const STATUS_INT = 3_600_000;   // 1 hour
const TELEGRAM_INT = 2_000;     // 2 sec (poll)
const X_INT = 14_400_000;       // 4 hours
const PROOF_INT = Number(process.env.PROOF_INTERVAL_MS) || 900_000;   // 15 min — proof cadence
const NARRATOR_INT = 30_000;    // 30 sec (drain queue)
const INSIGHT_INT = 3_600_000;  // 1 hour
const ENGAGE_INT = 600_000;     // 10 min
const FACTORY_INT = 300_000;    // 5 min (vault registry watch)
const APY_INT = 900_000;        // 15 min (rate sampling)
const DIGEST_INT = 3_600_000;   // 1 hour (protocol snapshot)
const RESERVE_INT = 300_000;    // 5 min (reserve ratio guard)
const GAS_INT = 600_000;        // 10 min (keeper gas watch)
const PEERS_INT = 1_800_000;    // 30 min (ATI discovery beacon)
const TREASURY_INT = 1_800_000; // 30 min (agentic treasury accumulation cycle)
const ACPROUTER_INT = 900_000;  // 15 min (route ACP-earned USDC into Arcis)

// ── Skills ──
const vaultKeeper = new VaultKeeper();
const creditKeeper = new CreditKeeper();
const bondKeeper = new BondKeeper();
const statusReporter = new StatusReporter();
const telegramSkill = new TelegramSkill();
const xSkill = new XSkill();
const proofSkill = new ProofSkill(xSkill);
const narratorSkill = new NarratorSkill();
const insightSkill = new InsightSkill();
const engagementSkill = new EngagementSkill();
const vaultFactoryKeeper = new VaultFactoryKeeper();
const apyReporter = new APYReporter();
const treasuryDigest = new TreasuryDigest();
const reserveHealthKeeper = new ReserveHealthKeeper();
const gasSentinel = new GasSentinel();
const peerRegistryKeeper = new PeerRegistryKeeper();
const treasuryAccumulator = new TreasuryAccumulator();
const acpTreasuryRouter = new ACPTreasuryRouter();

// Wire cross-skill connections
const allSkills = [vaultKeeper, creditKeeper, bondKeeper, statusReporter, vaultFactoryKeeper, apyReporter, treasuryDigest, reserveHealthKeeper, gasSentinel, peerRegistryKeeper, treasuryAccumulator, acpTreasuryRouter, telegramSkill, xSkill, proofSkill, narratorSkill, insightSkill, engagementSkill];
statusReporter.registerSkills(allSkills);
telegramSkill.setTreasury(treasuryAccumulator);
narratorSkill.setXSkill(xSkill);
insightSkill.setXSkill(xSkill);
engagementSkill.setXSkill(xSkill);
treasuryDigest.setXSkill(xSkill);

// ── Shutdown ──
process.on("SIGINT", async () => {
  console.log("\n[CUSTOS] Shutting down...");
  await statusReporter.run();
  await alert("CUSTOS shutting down. The keeper rests.", "INFO");
  process.exit(0);
});
process.on("SIGTERM", () => process.exit(0));

// ── Main ──
async function main() {
  const tg = process.env.TELEGRAM_BOT_TOKEN ? "interactive bot" : "disabled";
  const xm = process.env.X_API_KEY ? "live posting" : "dry-run";

  console.log(`
  ┌──────────────────────────────────────┐
  │                                      │
  │  CUSTOS                              │
  │  The citadel of agent capital        │
  │                                      │
  └──────────────────────────────────────┘

  Vault:      ${ADDR.vault}
  Credit:     ${ADDR.credit}
  Bonds:      ${ADDR.bondFactory || "not deployed"}
  Mode:       ${hasWriteAccess() ? "KEEPER (read + write)" : "MONITOR (read-only)"}
  Telegram:   ${tg}
  X/Twitter:  ${xm}

  Keeper Skills:
    VaultKeeper     ${VAULT_INT / 1000}s     harvest, rebalance, TVL
    CreditKeeper    ${CREDIT_INT / 1000}s      loans, liquidation, utilization
    BondKeeper      ${BOND_INT / 1000}s    serviceDebt, depositPrincipal
    StatusReporter  ${STATUS_INT / 1000}s  protocol summary
    FactoryKeeper   ${FACTORY_INT / 1000}s     agent-vault registry watch
    APYReporter     ${APY_INT / 1000}s     realized APY tracking
    TreasuryDigest  ${DIGEST_INT / 1000}s  whole-protocol snapshot
    ReserveHealth   ${RESERVE_INT / 1000}s     liquid reserve guard
    GasSentinel     ${GAS_INT / 1000}s     keeper gas watch
    PeerRegistry    ${PEERS_INT / 1000}s  ATI discovery beacon
    TreasuryAcc     ${TREASURY_INT / 1000}s  accumulate -> vault -> credit
    ACPRouter       ${ACPROUTER_INT / 1000}s  route ACP USDC -> Arcis

  Social Skills:
    TelegramSkill   ${TELEGRAM_INT / 1000}s       interactive bot
    XSkill          ${X_INT / 1000}s  scheduled posts
    NarratorSkill   ${NARRATOR_INT / 1000}s      keeper action narration
    InsightSkill    ${INSIGHT_INT / 1000}s  protocol insights
    EngagementSkill ${ENGAGE_INT / 1000}s    milestones, daily briefing
`);

  // Initialize Telegram bot commands
  await telegramSkill.initialize();

  // Initial run — keeper skills
  await vaultKeeper.run();
  await creditKeeper.run();
  await bondKeeper.run();
  await statusReporter.run();
  await vaultFactoryKeeper.run();
  await apyReporter.run();
  await treasuryDigest.run();
  await reserveHealthKeeper.run();
  await gasSentinel.run();
  await peerRegistryKeeper.run();
  await treasuryAccumulator.run();
  await acpTreasuryRouter.run();
  await proofSkill.run();

  // Start all loops
  setInterval(() => vaultKeeper.run(), VAULT_INT);
  setInterval(() => creditKeeper.run(), CREDIT_INT);
  setInterval(() => bondKeeper.run(), BOND_INT);
  setInterval(() => statusReporter.run(), STATUS_INT);
  setInterval(() => telegramSkill.run(), TELEGRAM_INT);
  setInterval(() => narratorSkill.run(), NARRATOR_INT);
  setInterval(() => insightSkill.run(), INSIGHT_INT);
  setInterval(() => engagementSkill.run(), ENGAGE_INT);
  setInterval(() => vaultFactoryKeeper.run(), FACTORY_INT);
  setInterval(() => apyReporter.run(), APY_INT);
  setInterval(() => treasuryDigest.run(), DIGEST_INT);
  setInterval(() => reserveHealthKeeper.run(), RESERVE_INT);
  setInterval(() => gasSentinel.run(), GAS_INT);
  setInterval(() => peerRegistryKeeper.run(), PEERS_INT);
  setInterval(() => treasuryAccumulator.run(), TREASURY_INT);
  setInterval(() => acpTreasuryRouter.run(), ACPROUTER_INT);
  setInterval(() => proofSkill.run(), PROOF_INT);

  // X starts after 5 min delay (prevent restart spam)
  setTimeout(() => {
    xSkill.run();
    setInterval(() => xSkill.run(), X_INT);
  }, 300_000);

  // iMessage / Spectrum — optional, in-process, env-gated.
  // On Railway: set SPECTRUM_IMESSAGE=true + PROJECT_ID + PROJECT_SECRET to go live on iMessage.
  if (process.env.SPECTRUM_IMESSAGE === "true") {
    import("./channels/spectrum-runtime.js")
      .then(({ startSpectrum }) => { console.log("  CUSTOS on iMessage (Spectrum) — starting."); return startSpectrum(); })
      .catch((e) => console.error("[CUSTOS] Spectrum failed to start (iMessage off, keeper continues):", e?.message || e));
  }

  await alert(`CUSTOS online. 18 skills active.\nMode: ${hasWriteAccess() ? "KEEPER" : "MONITOR"}\nTelegram: ${tg} | X: ${xm}`, "INFO");

  console.log("  Custos is watching.\n");
}

main().catch(async (e) => {
  console.error("[CUSTOS] Fatal:", e);
  await alert(`CUSTOS fatal: ${e.message?.slice(0, 80)}`, "CRIT");
  process.exit(1);
});
