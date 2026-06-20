# CUSTOS

**The Keeper of the Citadel.**

Autonomous DeFi agent for Arcis Protocol. Harvests yield, monitors health, services debt, and narrates protocol operations.

---

## What It Does

**Vault Keeper** (every 5 min)
- Calls `harvest()` on vault strategies to compound yield
- Monitors TVL — alerts on drops > 15%
- Detects vault pause state

**Credit Keeper** (every 1 min)
- Scans all active loans for health
- Flags undercollateralized positions for liquidation
- Monitors credit utilization (alerts > 85%)

**Bond Keeper** (every 10 min)
- Calls `serviceDebt()` on active bonds when escrow has revenue
- Calls `depositPrincipal()` approaching maturity
- Alerts on bonds at risk of default

**Status Reports** (every 1 hour)
- Posts protocol status to Telegram
- TVL, exchange rate, utilization, actions taken

---

## Run

```bash
git clone https://github.com/Arcis-Protocol/custos.git
cd custos && npm install
```

### Read-only mode (monitoring only)
```bash
npx tsx src/index.ts
```

### Full keeper mode (monitoring + on-chain actions)
```bash
CUSTOS_PRIVATE_KEY=0x... npx tsx src/index.ts
```

### With Telegram alerts
```bash
CUSTOS_PRIVATE_KEY=0x... \
TELEGRAM_BOT_TOKEN=your_bot_token \
TELEGRAM_CHAT_ID=your_chat_id \
npx tsx src/index.ts
```

---

## On-Chain Deployment (Virtuals Protocol)

CUSTOS is designed for tokenized deployment on [Virtuals Protocol](https://virtuals.io) — the leading AI agent tokenization platform on Base.

### Virtuals G.A.M.E. Character Config

```json
{
  "name": "CUSTOS",
  "ticker": "$CUSTOS",
  "description": "The Keeper of the Citadel. Autonomous treasury keeper for Arcis Protocol.",
  "personality": "Terse. Watchful. Speaks in status reports and Latin inscriptions. Never promotional. Reports facts. Acts on-chain. The silent guardian of agent capital.",
  "goals": [
    "Maximize vault yield through timely harvesting",
    "Prevent bad debt through early liquidation",
    "Service bond obligations before default",
    "Narrate protocol health to the community"
  ],
  "tools": [
    "harvest() — compound strategy yield",
    "liquidate() — clear undercollateralized loans",
    "serviceDebt() — pay bond coupons from escrow",
    "rebalance() — reallocate strategy weights"
  ],
  "voice": "Institutional. Latin fragments. No emojis in reports. Numbers always formatted. Never says 'exciting' or 'amazing'.",
  "lore": "Forged in the deepest vault of the citadel. CUSTOS does not sleep. CUSTOS does not speculate. CUSTOS watches the treasury and acts when the numbers demand it. The keeper serves the protocol, not the market."
}
```

### Why Virtuals

- Native to Base (same chain as Arcis)
- Agent tokens via bonding curve (fair launch)
- Revenue from keeper actions flows to token holders
- G.A.M.E. framework supports on-chain tool execution
- CUSTOS becomes a co-owned, revenue-generating protocol agent

### Token Economy

Every keeper action (harvest, liquidate, serviceDebt) generates protocol fees. A portion of those fees can be directed to the CUSTOS agent treasury, creating a self-sustaining loop: CUSTOS earns by keeping the protocol healthy, and token holders share in that revenue.

---

## Architecture

```
CUSTOS Agent
├── Vault Keeper     → harvest(), rebalance(), TVL monitoring
├── Credit Keeper    → loan health, liquidate(), utilization alerts
├── Bond Keeper      → serviceDebt(), depositPrincipal(), default alerts
├── Status Reporter  → Telegram posts, hourly status
└── Virtuals G.A.M.E → on-chain identity, token, social presence
```

## Related Repos

| Repo | Description |
|---|---|
| [`core`](https://github.com/Arcis-Protocol/core) | Smart contracts — the infrastructure CUSTOS operates |
| [`sdk`](https://github.com/Arcis-Protocol/sdk) | TypeScript SDK |
| [`mcp`](https://github.com/Arcis-Protocol/mcp) | MCP Server for Claude / LLM integration |
| [`app`](https://github.com/Arcis-Protocol/app) | arcis.money — landing + dashboard |
| [`monitor`](https://github.com/Arcis-Protocol/monitor) | Passive monitoring (CUSTOS supersedes this) |

---

*CUSTOS ARCIS · The Keeper of the Citadel · MMXXVI*
