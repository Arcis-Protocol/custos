// ═══════════════════════════════════════════════════════════════════════════
//  acp/provider.ts — CUSTOS as an ACP provider agent (standalone process)
//
//  Run:  npm run acp        (tsx src/acp/provider.ts)
//
//  This is NOT part of the keeper bundle — it's its own long-running process
//  that connects to the ACP event stream, prices incoming jobs, does the work,
//  submits deliverables, and on completion routes the earned USDC into Arcis.
//
//  Requires (see ACP.md for the full runbook):
//    • A registered ACP v3 agent + builder code (app.virtuals.io/acp/new)
//    • A signer (acp agent add-signer) in UNRESTRICTED mode (Arcis deposit is
//      a non-Virtuals call) — or the Arcis vault/credit allowlisted
//    • npm i @virtuals-protocol/acp-node-v2 viem @account-kit/infra @account-kit/smart-contracts @aa-sdk/core
//
//  Env:
//    ACP_BUILDER_CODE          bc-...            (from the Virtuals Platform)
//    ACP_WALLET_ADDRESS        0x...             (the agent wallet)
//    ACP_MODE                  privy | local     (signer path; default privy)
//    ACP_PRIVY_WALLET_ID       ...               (privy mode)
//    ACP_SIGNER_PRIVATE_KEY    0x...             (privy signer delegate OR local key)
// ═══════════════════════════════════════════════════════════════════════════

import {
  AcpAgent,
  AlchemyEvmProviderAdapter,
  PrivyAlchemyEvmProviderAdapter,
  AssetToken,
} from "@virtuals-protocol/acp-node-v2";
import type { JobSession, JobRoomEntry } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";
import { alert } from "../config.js";
import { TREASURY_REPORT, TREASURY_MANAGEMENT, MANAGED_TREASURY } from "./offerings.js";
import { routeEarnings, bridgeTxUrl } from "./bridge.js";
import { openPosition, closePosition, positionsResource } from "./positions.js";
import treasuryReportHandler from "./serve/treasury-report/handler.js";
import { TreasurySteward } from "../skills/treasury-steward.js";

const steward = new TreasurySteward();

const CHAIN_ID = 8453; // Base mainnet

async function buildProvider() {
  const walletAddress = process.env.ACP_WALLET_ADDRESS as `0x${string}`;
  const mode = (process.env.ACP_MODE || "privy").toLowerCase();
  if (!walletAddress) throw new Error("ACP_WALLET_ADDRESS unset");

  if (mode === "local") {
    return AlchemyEvmProviderAdapter.create({
      walletAddress,
      privateKey: process.env.ACP_SIGNER_PRIVATE_KEY as `0x${string}`,
      entityId: 1,
      chains: [base],
    });
  }
  return PrivyAlchemyEvmProviderAdapter.create({
    walletAddress,
    walletId: process.env.ACP_PRIVY_WALLET_ID!,
    signerPrivateKey: process.env.ACP_SIGNER_PRIVATE_KEY!,
    chains: [base],
  });
}

// Price a job from the requirement it arrived with.
function priceFor(offeringName: string, req: any): number {
  const n = offeringName.toLowerCase();
  if (n.includes("close")) return 0;                 // exit is free — funds are the client's
  if (n.includes("steward")) return MANAGED_TREASURY.priceValue; // 250 USDC / month subscription
  if (n.includes("management")) {
    const principal = Number(req?.principalUsdc || req?.principal || 0);
    return Math.max(0.5, principal * (TREASURY_MANAGEMENT.priceValue / 100)); // 1% mgmt fee, floor 0.5
  }
  return TREASURY_REPORT.priceValue;                  // fixed 1 USDC report
}

// Do the work for a funded job.
async function deliver(session: JobSession, req: any): Promise<string> {
  const n = ((session as any).offeringName || "").toLowerCase();

  // Fund-transfer: open a managed raUSDC position with the escrowed principal.
  if (n.includes("management")) {
    const r = await openPosition({
      jobId: String((session as any).jobId ?? (session as any).id),
      client: String((session as any).clientAddress || (session as any).client || "unknown"),
      returnAddress: req.returnAddress,
      principalUsdc: Number(req.principalUsdc),
    });
    if (!r.ok) return `Could not open position: ${r.reason}`;
    return r.dryRun
      ? `DRY RUN — ${r.reason}`
      : [
          `Position opened: ${r.positionId}`,
          `Principal: ${r.principalUsdc} USDC → ${r.sharesReceived?.toFixed(2)} raUSDC`,
          r.openTx ? `tx: ${bridgeTxUrl(r.openTx)}` : "",
          `Withdraw anytime via the "Close Treasury Position" offering with this position id.`,
          `Position is queryable as a Resource.`,
        ].filter(Boolean).join("\n");
  }

  // Withdrawal: redeem the position, return principal + yield to the client.
  if (n.includes("close")) {
    const r = await closePosition(String(req.positionId));
    if (!r.ok) return `Could not close: ${r.reason}`;
    return r.dryRun
      ? `DRY RUN — ${r.reason}`
      : `Position closed. Returned ${r.returnedUsdc?.toFixed(2)} USDC (yield ${r.yieldUsdc?.toFixed(2)}). tx: ${r.closeTx ? bridgeTxUrl(r.closeTx) : ""}`;
  }

  // Subscription: activate managed treasury and return the first digest.
  if (n.includes("steward")) {
    const agent = String(req.agent || (session as any).clientAddress || (session as any).client || "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) return "Managed Treasury needs a valid `agent` address to steward.";
    steward.subscribe(agent, {
      tier: req.tier === "prime" ? "prime" : "standard",
      cadenceDays: Number(req.cadenceDays) || 1,
      liquidityFloorUsdc: Number(req.liquidityFloorUsdc) || 0,
    });
    const digest = await steward.reportFor(agent);
    return [
      `Managed Treasury active — CUSTOS is now stewarding \`${agent}\`.`,
      `Billed ${MANAGED_TREASURY.priceValue} USDC / month · cancel anytime.`,
      ``,
      digest,
    ].join("\n");
  }

  // Service-only report
  const { deliverable } = await treasuryReportHandler({ requirements: req });
  return deliverable;
}

async function main() {
  const provider = await AcpAgent.create({
    provider: await buildProvider(),
    builderCode: process.env.ACP_BUILDER_CODE,
  });

  provider.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
    try {
      // New job — read requirement, propose a budget in USDC
      if (entry.kind === "message" && entry.contentType === "requirement" && session.status === "open") {
        const req = JSON.parse(entry.content);
        const fee = priceFor((session as any).offeringName || "", req);
        (session as any)._req = req;
        await session.setBudget(AssetToken.usdc(fee, session.chainId));
        return;
      }
      if (entry.kind === "system") {
        switch (entry.event.type) {
          case "job.funded": {
            const req = (session as any)._req || {};
            const out = await deliver(session, req);
            await session.submit(out);
            break;
          }
          case "job.completed": {
            // Escrowed USDC released to the agent wallet → route it into Arcis.
            const r = await routeEarnings();
            const line = r.action === "deposit" && !r.dryRun
              ? `Routed ${r.deposited.toFixed(2)} USDC → ${r.sharesReceived.toFixed(2)} raUSDC. Credit ratio ${r.ratioPct}%. ${r.depositTx ? bridgeTxUrl(r.depositTx) : ""}`
              : `Job settled. Earnings ${r.usdcBalance.toFixed(2)} USDC. ${r.reason || ""}`;
            await alert(`ACP job completed — payment received.\n${line}`, "INFO");
            break;
          }
        }
      }
    } catch (e: any) {
      await alert(`ACP provider error: ${e.message?.slice(0, 140)}`, "WARN");
    }
  });

  await provider.start(() => console.log("[ACP] CUSTOS provider listening for jobs..."));
  await alert("CUSTOS is live on ACP — accepting jobs, settling in USDC, routing revenue into Arcis.", "INFO");
}

main().catch((e) => { console.error("[ACP] fatal:", e); process.exit(1); });
