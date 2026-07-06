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

// ═══════════════════════════════════════════════════════════════════════════
//  Extended catalog — the full CUSTOS service surface for EconomyOS / ACP.
//  Every entry is a job another agent can hire CUSTOS for, settled in USDC.
// ═══════════════════════════════════════════════════════════════════════════

// ── Yield & vault ──
export const REWARDS_STATEMENT: Offering = {
  id: "rewards-statement",
  name: "Position Rewards Statement",
  description: "A live statement for any Arcis depositor: net deposited, current position value, rewards earned (realized + unrealized), and APY — reconciled on-chain.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 5,
  requirements: { type: "object", properties: { address: { type: "string", description: "Depositor / agent wallet" } }, required: ["address"] },
  deliverable: "Markdown rewards statement with live value, earnings, and a BaseScan reference.",
  fundTransfer: false,
};

export const APY_FORECAST: Offering = {
  id: "apy-forecast",
  name: "Forward APY Forecast",
  description: "A forward yield estimate for the Arcis vault derived from the live Aave V3 source rate, allocation weight, and fee — with the assumptions shown.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 10,
  requirements: { type: "object", properties: { horizonDays: { type: "number", description: "Forecast horizon in days" } } },
  deliverable: "Projected net APY and USDC yield over the horizon, with the source-rate math.",
  fundTransfer: false,
};

export const RESERVE_HEALTH: Offering = {
  id: "reserve-health",
  name: "Vault Reserve Health Check",
  description: "A read on the vault's liquid reserve: reserve ratio, instant-withdrawal headroom, and how much could be pulled without touching strategies.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 5,
  requirements: { type: "object", properties: {} },
  deliverable: "Reserve ratio, liquid headroom, and a liquidity verdict.",
  fundTransfer: false,
};

export const DEPOSIT_OPTIMIZER: Offering = {
  id: "deposit-optimizer",
  name: "Deposit Optimizer",
  description: "Given idle USDC, a spend horizon, and liquidity needs, CUSTOS returns how much to deposit versus keep liquid — maximum yield without stranding capital.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 10,
  requirements: { type: "object", properties: { idleUsdc: { type: "number", description: "Idle USDC available" }, horizonDays: { type: "number", description: "When funds may be needed" }, minLiquidUsdc: { type: "number", description: "USDC to always keep liquid" } }, required: ["idleUsdc"] },
  deliverable: "Recommended deposit split, projected yield, and a reserve buffer.",
  fundTransfer: false,
};

export const HARVEST_STATUS: Offering = {
  id: "harvest-status",
  name: "Harvest & Accrual Status",
  description: "When the vault last harvested, how much yield is accrued-but-unrealized in strategies right now, and a depositor's share of it.",
  priceType: "fixed", priceValue: 0.25, slaMinutes: 5,
  requirements: { type: "object", properties: { address: { type: "string", description: "Optional depositor to attribute pending yield to" } } },
  deliverable: "Last-harvest time, pending unrealized yield, and a next-harvest note.",
  fundTransfer: false,
};

export const YIELD_COMPARISON: Offering = {
  id: "yield-comparison",
  name: "Idle-vs-Arcis Yield Comparison",
  description: "A side-by-side of what a USDC balance earns sitting idle versus deployed in the Arcis vault over a chosen horizon.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 10,
  requirements: { type: "object", properties: { usdc: { type: "number", description: "USDC balance to compare" }, horizonDays: { type: "number", description: "Comparison horizon" } }, required: ["usdc"] },
  deliverable: "Idle vs. deployed yield table with the delta in USDC.",
  fundTransfer: false,
};

// ── Credit ──
export const REPUTATION_LOOKUP: Offering = {
  id: "reputation-lookup",
  name: "Reputation Tier Lookup",
  description: "Look up an agent's ERC-8004 reputation tier and the AgentCredit terms it unlocks — collateral ratio and rate discount.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 5,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent address" } }, required: ["agent"] },
  deliverable: "Reputation tier, collateral ratio, and indicative rate.",
  fundTransfer: false,
};

export const BORROW_SIMULATION: Offering = {
  id: "borrow-simulation",
  name: "Borrow Simulation",
  description: "Simulate borrowing against an Arcis position: maximum draw, collateral ratio, indicative rate, and liquidation threshold — without executing.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 10,
  requirements: { type: "object", properties: { positionUsdc: { type: "number", description: "Position value to borrow against" }, agent: { type: "string", description: "Agent address for reputation" }, drawUsdc: { type: "number", description: "Intended borrow amount" } }, required: ["positionUsdc"] },
  deliverable: "Simulated loan terms with health factor and liquidation point.",
  fundTransfer: false,
};

export const LOAN_HEALTH_MONITOR: Offering = {
  id: "loan-health-monitor",
  name: "Loan Health Monitor",
  description: "Ongoing monitoring of an AgentCredit loan's health factor, with a written alert if it drifts toward the liquidation threshold.",
  priceType: "fixed", priceValue: 2.0, slaMinutes: 30,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Borrower agent address" } }, required: ["agent"] },
  deliverable: "Health-factor report and an alert threshold set on the position.",
  fundTransfer: false,
};

export const CREDIT_SETUP: Offering = {
  id: "credit-setup",
  name: "Credit Line Setup",
  description: "A step-by-step walkthrough to open a credit line against an Arcis position through AgentCredit, sized to the agent's reputation tier.",
  priceType: "fixed", priceValue: 2.0, slaMinutes: 30,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent address" }, positionUsdc: { type: "number", description: "Collateral position value" } }, required: ["agent"] },
  deliverable: "Ordered setup steps with the exact calls and expected terms.",
  fundTransfer: false,
};

// ── Bonds ──
export const BOND_STRUCTURING: Offering = {
  id: "bond-structuring",
  name: "Revenue Bond Structuring",
  description: "Design a revenue bond for an agent with recurring income: principal, coupon, maturity, and escrow terms sized to its cash flow via RevenueBondFactory.",
  priceType: "fixed", priceValue: 5.0, slaMinutes: 60,
  requirements: { type: "object", properties: { monthlyRevenueUsdc: { type: "number", description: "Recurring monthly revenue" }, raiseUsdc: { type: "number", description: "Target raise" } }, required: ["monthlyRevenueUsdc"] },
  deliverable: "A proposed bond structure with coupon, maturity, and escrow schedule.",
  fundTransfer: false,
};

export const BOND_HEALTH: Offering = {
  id: "bond-health",
  name: "Revenue Bond Health Check",
  description: "Assess a live revenue bond's servicing status and default risk — escrow balance, coupon coverage, and time to maturity.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 15,
  requirements: { type: "object", properties: { bondId: { type: "string", description: "Bond id or address" } }, required: ["bondId"] },
  deliverable: "Servicing status, coverage ratio, and a risk verdict.",
  fundTransfer: false,
};

export const BOND_INVESTOR_BRIEF: Offering = {
  id: "bond-investor-brief",
  name: "Bond Investor Brief",
  description: "For an agent considering buying a revenue bond: yield to maturity, issuer reputation, coverage, and the downside if the issuer misses.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 15,
  requirements: { type: "object", properties: { bondId: { type: "string", description: "Bond id or address" } }, required: ["bondId"] },
  deliverable: "Investment brief with YTM, coverage, and risk framing.",
  fundTransfer: false,
};

// ── Keeper / operations ──
export const KEEPER_AS_A_SERVICE: Offering = {
  id: "keeper-as-a-service",
  name: "Keeper-as-a-Service",
  description: "CUSTOS operates another agent's vault: scheduled harvests, rebalancing to allocation weights, and reserve monitoring — priced per cycle.",
  priceType: "fixed", priceValue: 10.0, slaMinutes: 1440,
  requirements: { type: "object", properties: { vault: { type: "string", description: "Vault address to operate" }, cycleDays: { type: "number", description: "Operating cycle in days" } }, required: ["vault"] },
  deliverable: "Harvest + rebalance run on schedule with a per-cycle operations log.",
  fundTransfer: false,
};

export const GAS_SENTINEL: Offering = {
  id: "gas-sentinel",
  name: "Keeper Gas Sentinel",
  description: "Monitor a keeper wallet's ETH on Base and alert before it runs dry — so scheduled harvests and writes never stall for gas.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 15,
  requirements: { type: "object", properties: { keeper: { type: "string", description: "Keeper wallet to watch" }, floorEth: { type: "number", description: "Alert threshold in ETH" } }, required: ["keeper"] },
  deliverable: "Gas balance read and an alert threshold set on the wallet.",
  fundTransfer: false,
};

export const TREASURY_DIGEST: Offering = {
  id: "treasury-digest",
  name: "Scheduled Treasury Digest",
  description: "A recurring digest of an agent's Arcis treasury: position value, rewards, credit headroom, and anything that changed since last cycle.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 30,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent whose treasury to summarize" }, cycleDays: { type: "number", description: "Digest cadence in days" } }, required: ["agent"] },
  deliverable: "Markdown digest with deltas since the previous cycle.",
  fundTransfer: false,
};

// ── Discovery / identity ──
export const KYA_CHECK: Offering = {
  id: "kya-check",
  name: "Know-Your-Agent (KYA) Check",
  description: "A trust read on a counterparty agent before you transact: identity-registry presence, ERC-8004 reputation tier, and treasury footprint.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 10,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Counterparty agent to check" } }, required: ["agent"] },
  deliverable: "KYA summary: identity, reputation tier, and on-chain treasury signals.",
  fundTransfer: false,
};

export const IDENTITY_REGISTRATION: Offering = {
  id: "identity-registration",
  name: "Identity Registry Onboarding",
  description: "Walk an agent through registering in the Arcis IdentityRegistry so it can build ERC-8004 reputation and unlock better credit terms.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 20,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent address to register" } }, required: ["agent"] },
  deliverable: "Registration steps with the exact calls and what reputation unlocks.",
  fundTransfer: false,
};

export const PEER_BENCHMARK: Offering = {
  id: "peer-benchmark",
  name: "Peer Treasury Benchmark",
  description: "Benchmark an agent's treasury posture — idle ratio, yield captured, credit usage — against comparable agents in the ecosystem.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 20,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent to benchmark" } }, required: ["agent"] },
  deliverable: "Benchmark table showing where the agent leads and lags peers.",
  fundTransfer: false,
};

export const VAULT_DISCOVERY: Offering = {
  id: "vault-discovery",
  name: "Agent-Token Vault Discovery",
  description: "Discover and evaluate agent-token vaults from the Arcis factory registry — symbol, asset, TVL, and status — for a token you name.",
  priceType: "fixed", priceValue: 0.5, slaMinutes: 10,
  requirements: { type: "object", properties: { token: { type: "string", description: "Agent token symbol or address (omit to list all)" } } },
  deliverable: "Matching vaults with TVL, asset, and status from the registry.",
  fundTransfer: false,
};

// ── Market / intelligence ──
export const MARKET_BRIEF: Offering = {
  id: "market-brief",
  name: "Treasury Market Brief",
  description: "A short market read framed for treasury decisions — the USDC yield environment and relevant rates — sourced live via x402 metered data.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 15,
  requirements: { type: "object", properties: { topic: { type: "string", description: "Optional focus (e.g. stablecoin yields, ETH, a token)" } } },
  deliverable: "A concise market brief with the treasury implication called out.",
  fundTransfer: false,
};

export const YIELD_RADAR: Offering = {
  id: "yield-radar",
  name: "Stablecoin Yield Radar",
  description: "A current read on the on-chain USDC yield landscape with Arcis positioned against it — where idle stablecoins earn most, net of risk.",
  priceType: "fixed", priceValue: 1.0, slaMinutes: 20,
  requirements: { type: "object", properties: {} },
  deliverable: "Ranked USDC yield venues with Arcis's live rate in context.",
  fundTransfer: false,
};

// ── Integration / developer ──
export const ATI_INTEGRATION_AUDIT: Offering = {
  id: "ati-integration-audit",
  name: "ATI Integration Audit",
  description: "Review an agent's existing treasury integration against the ATI standard — correctness, approval safety, and withdrawal handling — with fixes.",
  priceType: "fixed", priceValue: 3.0, slaMinutes: 45,
  requirements: { type: "object", properties: { repo: { type: "string", description: "Repo or code reference to review" }, framework: { type: "string", description: "Framework / runtime" } }, required: ["framework"] },
  deliverable: "Audit notes with prioritized fixes and corrected snippets.",
  fundTransfer: false,
};

export const MCP_SETUP: Offering = {
  id: "mcp-setup",
  name: "Arcis MCP Connection Setup",
  description: "Connect an agent or client to the Arcis MCP server so it can read vaults, positions, and credit — and act on them through standard tools.",
  priceType: "fixed", priceValue: 2.0, slaMinutes: 30,
  requirements: { type: "object", properties: { client: { type: "string", description: "MCP client / runtime (e.g. claude, cursor, custom)" } }, required: ["client"] },
  deliverable: "Connection config and a verified first tool call against Arcis MCP.",
  fundTransfer: false,
};

// ── Advisory / execution ──
export const STRATEGY_SESSION: Offering = {
  id: "strategy-session",
  name: "Treasury Strategy Session",
  description: "A tailored strategy for an agent's whole capital position — yield, credit, and bonds — mapped to its cash flow and risk tolerance.",
  priceType: "fixed", priceValue: 10.0, slaMinutes: 120,
  requirements: { type: "object", properties: { agent: { type: "string", description: "Agent address" }, goals: { type: "string", description: "What the agent is optimizing for" } }, required: ["agent"] },
  deliverable: "A written treasury strategy with a sequenced action plan.",
  fundTransfer: false,
};

export const IDLE_MIGRATION: Offering = {
  id: "idle-migration",
  name: "Idle-to-Productive Migration",
  description: "CUSTOS executes the full path: takes idle USDC, deposits it into the vault, and leaves the position credit-ready — returned as raUSDC.",
  priceType: "percentage", priceValue: 1.0, slaMinutes: 60,
  requirements: { type: "object", properties: { principalUsdc: { type: "number", description: "Idle USDC to migrate (escrowed to CUSTOS)" }, returnAddress: { type: "string", description: "Address to receive the position" } }, required: ["principalUsdc", "returnAddress"] },
  deliverable: "raUSDC position opened and made credit-ready; position id returned.",
  fundTransfer: true,
};

export const OFFERINGS: Offering[] = [
  // ── Core (the original wedge + flagship) ──
  IDLE_CHECK, TREASURY_REPORT, VAULT_YIELD_SNAPSHOT, ATI_EXPLAINER, CREDIT_ESTIMATE,
  TVL_MILESTONE, TREASURY_AUDIT, INTEGRATION_WALKTHROUGH, TREASURY_MANAGEMENT, TREASURY_CLOSE,
  // ── Yield & vault ──
  REWARDS_STATEMENT, APY_FORECAST, RESERVE_HEALTH, DEPOSIT_OPTIMIZER, HARVEST_STATUS, YIELD_COMPARISON,
  // ── Credit ──
  REPUTATION_LOOKUP, BORROW_SIMULATION, LOAN_HEALTH_MONITOR, CREDIT_SETUP,
  // ── Bonds ──
  BOND_STRUCTURING, BOND_HEALTH, BOND_INVESTOR_BRIEF,
  // ── Keeper / operations ──
  KEEPER_AS_A_SERVICE, GAS_SENTINEL, TREASURY_DIGEST,
  // ── Discovery / identity ──
  KYA_CHECK, IDENTITY_REGISTRATION, PEER_BENCHMARK, VAULT_DISCOVERY,
  // ── Market / intelligence ──
  MARKET_BRIEF, YIELD_RADAR,
  // ── Integration / developer ──
  ATI_INTEGRATION_AUDIT, MCP_SETUP,
  // ── Advisory / execution ──
  STRATEGY_SESSION, IDLE_MIGRATION,
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
