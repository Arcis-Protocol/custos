// ═══════════════════════════════════════════════════
//  CUSTOS VOICE — Personality & Response Generation
// ═══════════════════════════════════════════════════

// CUSTOS speaks as a protocol agent, not a chatbot.
// Terse. Declarative. Data-first. Latin sparingly.
// Never promotional. Never excited. Reports facts.

const GREETINGS = [
  "Custos vigil.",
  "The keeper watches.",
  "The citadel stands.",
  "Custos operatur.",
];

const SIGN_OFFS = [
  "Vigilia aeterna.",
  "The keeper watches.",
  "Custos nunquam dormit.",
  "Fortis pecunia machinae.",
];

const UNKNOWN = [
  "That query falls outside the citadel's walls.",
  "Custos monitors the protocol. Ask about vault, credit, or bonds.",
  "I watch the treasury, not the market. Ask /status.",
];

export function greeting(): string {
  return pick(GREETINGS);
}

export function signOff(): string {
  return pick(SIGN_OFFS);
}

export function unknownQuery(): string {
  return pick(UNKNOWN);
}

// Format a keeper action report for social posting
export function actionReport(action: string, detail: string): string {
  return `${action}. ${detail}`;
}

// Format a status report for X (280 char limit)
export function xStatus(tvl: string, rate: string, util: string, actions: number, uptime: string): string {
  return [
    `Vault TVL: ${tvl}`,
    `Rate: ${rate} USDC/raUSDC`,
    `Credit util: ${util}`,
    ``,
    `Keeper: ${actions} actions | Up: ${uptime}`,
    ``,
    signOff(),
  ].join("\n");
}

// Format a harvest report for X
export function xHarvest(amount: string, totalHarvested: string): string {
  return [
    `Harvested ${amount} yield.`,
    `Cumulative: ${totalHarvested}`,
    ``,
    `The citadel compounds.`,
  ].join("\n");
}

// Format an alert for X
export function xAlert(level: string, message: string): string {
  const icon = level === "CRIT" ? "\u{1F534}" : level === "WARN" ? "\u{1F7E1}" : "\u{1F7E2}";
  return `${icon} ${message}`;
}

// Format a thesis comment for X
export function xThesis(): string {
  const theses = [
    "69K+ agents hold capital on-chain. Zero financial instruments designed for them. That gap is Arcis.",
    "$27B in tokenized RWA. 8-12% of DeFi volume from agents. The infrastructure isn't ready. We're building it.",
    "Not agents as assets. Assets for agents. Three functions: deposit, withdraw, balance. The ATI standard.",
    "AI agents need yield on idle capital. Not a dashboard. Not a wallet connect flow. A three-function API.",
    "Every protocol needs a keeper. CUSTOS harvests yield, monitors loans, services bonds. Autonomously.",
    "The ATI is an open standard. deposit(). withdraw(). balance(). Any agent framework. No gatekeepers.",
    "DeFi was built for humans clicking dashboards. Agent DeFi is built for machines calling functions.",
    "Agents earn 0% on idle USDC in EOA wallets. The citadel changes that.",
  ];
  return pick(theses);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
