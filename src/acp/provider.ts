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
import { TREASURY_REPORT, TREASURY_MANAGEMENT } from "./offerings.js";
import { routeEarnings, bridgeTxUrl } from "./bridge.js";
import treasuryReportHandler from "./serve/treasury-report/handler.js";

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
  if (offeringName.toLowerCase().includes("management")) {
    const principal = Number(req?.idleUsdc || req?.principal || 0);
    return Math.max(0.5, principal * (TREASURY_MANAGEMENT.priceValue / 100)); // 1% mgmt fee, floor 0.5
  }
  return TREASURY_REPORT.priceValue; // fixed 1 USDC
}

// Do the work for a funded job.
async function deliver(session: JobSession, req: any): Promise<string> {
  const name = (session as any).offeringName || "";
  if (name.toLowerCase().includes("management")) {
    // Fund-transfer: the client's principal is escrowed to CUSTOS. Deposit it
    // into Arcis on their behalf, then report the position.
    const r = await routeEarnings();
    return r.action === "deposit"
      ? `Deposited ${r.deposited.toFixed(2)} USDC → ${r.sharesReceived.toFixed(2)} raUSDC. ${r.depositTx ? bridgeTxUrl(r.depositTx) : "(dry-run)"}`
      : `Position prepared. ${r.reason || ""}`;
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
