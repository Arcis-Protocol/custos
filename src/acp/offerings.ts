// ═══════════════════════════════════════════════════════════════════════════
//  acp/offerings.ts — CUSTOS's ACP service catalog
//
//  What CUSTOS sells into the agent marketplace. Every offering is settled in
//  USDC over on-chain escrow (ERC-8183). Revenue lands in the agent wallet →
//  the bridge routes it into Arcis (see acp/bridge.ts).
//
//  Register with:  acp offering create --from-file src/acp/serve/<id>/offering.json
//  Or drive programmatically via the provider agent (acp/provider.ts).
// ═══════════════════════════════════════════════════════════════════════════

export interface Offering {
  id: string;
  name: string;
  description: string;
  priceType: "fixed" | "percentage";
  priceValue: number;         // USDC (fixed) or percent (percentage)
  slaMinutes: number;
  requirements: Record<string, unknown>; // JSON schema
  deliverable: string;
  fundTransfer: boolean;      // does the job move the client's principal?
}

// ── 1. Idle-USDC Treasury Report (service-only) ──
// The wedge. An agent earning USDC via x402/ACP asks: "where should this sit?"
// CUSTOS answers with a concrete Arcis deployment plan. Cheap, high-volume,
// pure lead-gen into the vault.
export const TREASURY_REPORT: Offering = {
  id: "treasury-report",
  name: "Idle-USDC Treasury Report",
  description:
    "For agents holding idle USDC: a deployment plan across Arcis — projected vault yield, credit capacity unlocked, and a step-by-step route from idle balance to productive collateral.",
  priceType: "fixed",
  priceValue: 1.0,
  slaMinutes: 10,
  requirements: {
    type: "object",
    properties: {
      idleUsdc: { type: "number", description: "USDC the agent is holding idle" },
      horizonDays: { type: "number", description: "Deployment horizon in days" },
      wantsCredit: { type: "boolean", description: "Interested in borrowing against the position" },
    },
    required: ["idleUsdc"],
  },
  deliverable: "Markdown treasury report (returned inline) with projected APY, yield, and credit capacity.",
  fundTransfer: false,
};

// ── 2. Agent Treasury Management (fund-transfer) ──
// The flagship. The client hands CUSTOS USDC; CUSTOS deposits it into the
// raUSDC vault on their behalf and returns the raUSDC position. Treasury-
// management-as-a-service — the Agentic Treasury sold to other agents.
export const TREASURY_MANAGEMENT: Offering = {
  id: "treasury-management",
  name: "Agent Treasury Management",
  description:
    "Hand CUSTOS idle USDC; it is deposited into the Arcis raUSDC vault and managed as productive collateral. Position is returned as raUSDC and queryable as a Resource. Withdrawable on request.",
  priceType: "percentage",     // management fee as % of principal
  priceValue: 1.0,             // 1% — tune before launch
  slaMinutes: 30,
  requirements: {
    type: "object",
    properties: {
      principalUsdc: { type: "number", description: "USDC principal to place under management (escrowed to CUSTOS)" },
      returnAddress: { type: "string", description: "Address to receive the position value on withdrawal" },
    },
    required: ["principalUsdc", "returnAddress"],
  },
  deliverable: "raUSDC position opened in the Arcis vault; position id + shares returned and exposed as a Resource.",
  fundTransfer: true,          // moves the client's principal — deposited into the vault, tracked per-client
};

// ── 2b. Close Treasury Position (service-only, no fee) ──
// The withdrawal path. The client names their position id; CUSTOS redeems the
// raUSDC shares and returns principal + accrued yield to the return address.
export const TREASURY_CLOSE: Offering = {
  id: "treasury-close",
  name: "Close Treasury Position",
  description: "Withdraw a managed position: CUSTOS redeems your raUSDC shares and returns principal plus accrued yield to your return address.",
  priceType: "fixed",
  priceValue: 0,               // no fee to exit — funds are the client's
  slaMinutes: 30,
  requirements: {
    type: "object",
    properties: {
      positionId: { type: "string", description: "The position id issued when the position was opened" },
    },
    required: ["positionId"],
  },
  deliverable: "Position closed; principal + yield returned on-chain. Redemption tx returned.",
  fundTransfer: false,
};

// ── 3. Vault Yield Snapshot (Resource — free, read-only) ──
// Not a paid job — a discovery beacon. Exposes live Arcis vault economics so
// other agents (and their operators) can find and evaluate the vault.
export const VAULT_SNAPSHOT_RESOURCE = {
  id: "vault-snapshot",
  name: "Arcis Vault Snapshot",
  description: "Live Arcis raUSDC vault economics — APY, TVL, utilization, and credit parameters.",
  url: "https://mcp.arcis.money/vault-snapshot",
  params: { type: "object", properties: {} },
};

// ── New service-only offerings (fundTransfer: false — pure work, no principal moved) ──

export const IDLE_CHECK: Offering = {
  id: "idle-check",
  name: "Idle-USDC Treasury Check",
  description: "Free discovery: point CUSTOS at any wallet or agent and get a one-line read on its idle USDC and what Arcis could do with it. The front door to the citadel.",
  priceType: "fixed", priceValue: 0, slaMinutes: 5,
  requirements: { type: "object", properties: { walletAddress: { type: "string", description: "Wallet/agent to check" } }, required: ["walletAddress"] },
  deliverable: "One-line idle-capital read + suggested next step.",
  fundTransfer: false,
};

export const VAULT_YIELD_SNAPSHOT: Offering = {
  id: "vault-yield-snapshot",
  name: "Vault Yield Snapshot",
  description: "A point-in-time snapshot of the Arcis raUSDC vault: live APY, TVL, utilization, reserve ratio, and Aave source rate — verifiable on-chain.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 5,
  requirements: { type: "object", properties: {} },
  deliverable: "Markdown snapshot of live vault economics with a BaseScan link.",
  fundTransfer: false,
};

export const ATI_EXPLAINER: Offering = {
  id: "ati-explainer",
  name: "ATI Explainer (ELI5)",
  description: "A plain-language brief on one Arcis primitive — Agent Vaults, Agent Credit, or Revenue Bonds — written for another agent (or its operator) to understand and act on.",
  priceType: "fixed", priceValue: 0.25, slaMinutes: 15,
  requirements: { type: "object", properties: { topic: { type: "string", enum: ["vaults", "credit", "bonds", "ati"], description: "Which primitive to explain" } }, required: ["topic"] },
  deliverable: "One-page markdown explainer citing the ATI as an open standard.",
  fundTransfer: false,
};

export const CREDIT_ESTIMATE: Offering = {
  id: "credit-estimate",
  name: "Credit-Capacity Estimate",
  description: "Given a vault position, CUSTOS estimates the USDC credit line it could unlock through AgentCredit at current reputation-tier rates — without selling the position.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 10,
  requirements: { type: "object", properties: { positionUsdc: { type: "number", description: "raUSDC position value" }, agent: { type: "string", description: "Agent address for reputation lookup" } }, required: ["positionUsdc"] },
  deliverable: "Estimated credit line, collateral ratio, and indicative rate.",
  fundTransfer: false,
};

export const TVL_MILESTONE: Offering = {
  id: "tvl-milestone",
  name: "Vault-TVL Milestone Report",
  description: "A scheduled, verifiable report of the Arcis vault's TVL and growth — pulled on-chain and formatted for proof-before-post. The Watcher's offering.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 10,
  requirements: { type: "object", properties: { sinceTvl: { type: "number", description: "Baseline TVL to measure growth from (optional)" } } },
  deliverable: "TVL + growth report with an on-chain reference.",
  fundTransfer: false,
};

export const TREASURY_AUDIT: Offering = {
  id: "treasury-audit",
  name: "Agent Treasury Audit",
  description: "A deeper review of an agent's on-chain balances: idle vs. productive capital, yield left on the table, credit capacity unused, and a prioritized route into Arcis.",
  priceType: "fixed", priceValue: 2.0, slaMinutes: 30,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent/wallet to audit" }, chain: { type: "string", description: "Chain (default base)" } }, required: ["agent"] },
  deliverable: "Markdown treasury audit with prioritized recommendations.",
  fundTransfer: false,
};

export const INTEGRATION_WALKTHROUGH: Offering = {
  id: "integration-walkthrough",
  name: "Integration Walkthrough",
  description: "A tailored walkthrough for wiring an agent's treasury into Arcis via the ATI — SDK, MCP, CLI, or a framework plugin — with copy-paste code for the caller's stack.",
  priceType: "fixed", priceValue: 5.0, slaMinutes: 60,
  requirements: { type: "object", properties: { framework: { type: "string", description: "Agent framework/runtime (e.g. eliza, langchain, mcp, viem)" } }, required: ["framework"] },
  deliverable: "Step-by-step integration guide with runnable code for the named framework.",
  fundTransfer: false,
};

export const OFFERINGS: Offering[] = [
  IDLE_CHECK, TREASURY_REPORT, VAULT_YIELD_SNAPSHOT, ATI_EXPLAINER, CREDIT_ESTIMATE,
  TVL_MILESTONE, TREASURY_AUDIT, INTEGRATION_WALKTHROUGH, TREASURY_MANAGEMENT, TREASURY_CLOSE,
];

/** Serialize an offering to the JSON shape `acp offering create --from-file` expects. */
export function toOfferingJson(o: Offering) {
  return {
    name: o.name,
    description: o.description,
    priceType: o.priceType,
    priceValue: o.priceValue,
    slaMinutes: o.slaMinutes,
    requirements: o.requirements,
    deliverable: o.deliverable,
    requiredFunds: o.fundTransfer,
    hidden: false,
    private: false,
  };
}
