# CUSTOS

**The Keeper of the Citadel.**

CUSTOS is the autonomous keeper agent for Arcis Protocol. It monitors protocol health, harvests yield from strategies, scans credit positions, services bond obligations, and alerts operators — without human intervention.

Every DeFi protocol needs a keeper. CUSTOS is Arcis's.

---

## Why a Keeper Agent

Yield doesn't compound itself. Unhealthy loans don't liquidate themselves. Bond coupons don't service themselves.

CUSTOS closes these operational gaps by running three keeper loops against the protocol's smart contracts, performing the maintenance actions that keep the system solvent, efficient, and healthy for every depositor, borrower, and bondholder.

---

## What It Does

**Vault Keeper** (every 5 min)
- Calls `harvest()` on yield strategies to compound returns
- Monitors TVL for sudden drops (alerts on > 15% decline)
- Detects vault pause state and alerts operators

**Credit Keeper** (every 1 min)
- Scans all active loans for collateral health
- Flags undercollateralized positions for liquidation
- Monitors credit pool utilization (alerts above 85%)

**Bond Keeper** (every 10 min)
- Calls `serviceDebt()` on active bonds when escrow has revenue
- Deposits principal approaching maturity deadlines
- Alerts on bonds at risk of default

**Status Reports** (every 1 hour)
- Posts protocol health summary to Telegram
- TVL, exchange rate, credit utilization, actions performed

---

## Run

```bash
git clone https://github.com/Arcis-Protocol/custos.git
cd custos && npm install
```

**Read-only (monitoring + alerts):**
```bash
npx tsx src/index.ts
```

**Full keeper (monitoring + on-chain actions):**
```bash
CUSTOS_PRIVATE_KEY=0x... npx tsx src/index.ts
```

**With Telegram alerts:**
```bash
CUSTOS_PRIVATE_KEY=0x... \
TELEGRAM_BOT_TOKEN=your_bot_token \
TELEGRAM_CHAT_ID=your_chat_id \
npx tsx src/index.ts
```

---

## Architecture

```
CUSTOS
├── Vault Keeper     → harvest(), rebalance(), TVL alerts
├── Credit Keeper    → loan health, liquidate(), utilization
├── Bond Keeper      → serviceDebt(), depositPrincipal()
└── Status Reporter  → Telegram, hourly protocol summary
```

CUSTOS uses the same ATI and contract interfaces that any external agent would. It dogfoods the protocol's own SDK patterns — if CUSTOS can operate the protocol autonomously, any agent framework can.

## Related Repos

| Repo | Description |
|---|---|
| [`core`](https://github.com/Arcis-Protocol/core) | Smart contracts CUSTOS operates against |
| [`sdk`](https://github.com/Arcis-Protocol/sdk) | TypeScript SDK — `@arcisprotocol/sdk` |
| [`mcp`](https://github.com/Arcis-Protocol/mcp) | MCP Server for Claude / LLM agents |
| [`app`](https://github.com/Arcis-Protocol/app) | arcis.money — landing + dashboard |
| [`docs`](https://github.com/Arcis-Protocol/docs) | ATI spec, integration guide |

---

*CUSTOS ARCIS · The Keeper watches. The citadel endures. · MMXXVI*
