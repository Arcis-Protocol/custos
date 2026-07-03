// ═══════════════════════════════════════════════════
//  CUSTOS VOICE — Personality & Response Generation
// ═══════════════════════════════════════════════════

// CUSTOS is a protocol keeper — knowledgeable, calm, helpful.
// Speaks with authority but not aggression.
// Data-first. Conversational when appropriate. Latin sparingly.
// Never promotional. Reports facts. Welcomes questions.

const GREETINGS = [
  "Welcome to the citadel. Type /help to see what I can do.",
  "The keeper is here. Ask me anything about the protocol.",
  "Welcome. I monitor the vaults, credit lines, and bonds. How can I help?",
  "Custos at your service. Try /status for a protocol overview.",
];

const SIGN_OFFS = [
  "Vigilia aeterna.",
  "The keeper watches.",
  "Custos nunquam dormit.",
];

const UNKNOWN = [
  "I'm focused on the Arcis protocol — try /status, /vault, /credit, /bonds, or /token for what I track.",
  "Not sure about that one. Try /help to see all my commands.",
  "That's outside my scope, but I'm happy to help with protocol data. Try /help.",
  "I track the vaults, credit, and bonds. Type /help to see what I can answer.",
];

const CASUAL = [
  "Hey! The citadel is operational. Try /status for the latest.",
  "What's up. The keeper is online. Need anything?",
  "All systems running. Ask me about the protocol anytime.",
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

export function casualResponse(): string {
  return pick(CASUAL);
}

// Format a keeper action report for social posting
export function actionReport(action: string, detail: string): string {
  return `${action}. ${detail}`;
}

// Format a status report for X (280 char limit)
export function xStatus(tvl: string, rate: string, util: string, apy: string, actions: number, uptime: string): string {
  return [
    `Vault TVL: ${tvl}`,
    `Rate: ${rate} USDC/raUSDC`,
    `APY: ${apy}% (Aave V3)`,
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

// Format an agent-vaults registry post for X
export function xVaults(count: number, firstSymbol: string): string {
  const noun = count === 1 ? "vault" : "vaults";
  const variants = [
    [
      `Any agent token can now have a vault.`,
      ``,
      `${count} agent ${noun} live on the factory. Deposit your token, receive a receipt, borrow against it.`,
      ``,
      `First: ${firstSymbol}. The citadel expands.`,
    ],
    [
      `The vault factory is live.`,
      ``,
      `${count} agent-token ${noun} deployed. Same security stack as the flagship. Custody plus credit collateral for any token.`,
      ``,
      signOff(),
    ],
    [
      `${firstSymbol} vault: live.`,
      ``,
      `Agent tokens deposit for custody and use the position as collateral — borrow without selling.`,
      ``,
      `Tres Functiones. Unum Foedus.`,
    ],
  ];
  return pick(variants).join("\n");
}

// Format a thesis comment for X
export function xThesis(): string {
  const theses = [
    "104K+ agents hold capital on-chain. Zero financial instruments designed for them. That gap is Arcis.",
    "$27.6B in tokenized RWA. 8-12% of DeFi volume from agents. The infrastructure isn't ready. We're building it.",
    "Not agents as assets. Assets for agents. Three functions: deposit, withdraw, balance. The ATI standard.",
    "AI agents need yield on idle capital. Not a dashboard. Not a wallet connect flow. Three smart contract calls.",
    "Every protocol needs a keeper. CUSTOS harvests yield, monitors loans, services bonds. Autonomously.",
    "The ATI is an open standard. deposit(). withdraw(). balance(). Any agent framework. No gatekeepers.",
    "DeFi was built for humans clicking dashboards. Agent DeFi is built for machines calling functions.",
    "Agents earn 0% on idle USDC. The citadel changes that. ~3.2% APY through Aave V3.",
    "$CUSTOS is tokenized on Virtuals. Not a chatbot — an economic actor operating live DeFi infrastructure.",
  ];
  return pick(theses);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
