# CUSTOS

**The Keeper of the Citadel.**

Autonomous keeper agent for Arcis Protocol. Harvests yield, monitors health, services debt, answers community questions, and reports protocol status — all without human intervention.

---

## Skills

**VaultKeeper** (5 min) — harvest yield, TVL monitoring, invariant checks

**CreditKeeper** (1 min) — loan scanning, liquidation, utilization alerts

**BondKeeper** (10 min) — serviceDebt, depositPrincipal, default alerts

**StatusReporter** (1 hour) — aggregated protocol summary to Telegram

---

## Social

**Telegram Bot** — interactive community agent. Responds to commands and natural language.

| Command | Response |
|---|---|
| /status | Full protocol overview |
| /vault | TVL, exchange rate, capacity |
| /credit | Lending pool, utilization |
| /bonds | Revenue bond status |
| /ati | Agent Treasury Interface spec |
| "what is arcis" | Protocol description |
| "gm" | Keeper greeting |

**X/Twitter** — scheduled posts alternating between protocol status updates and thesis commentary. Terse, institutional, never promotional.

---

## Run

```bash
git clone https://github.com/Arcis-Protocol/custos.git
cd custos && npm install
```

**Monitor only:**
```bash
npx tsx src/index.ts
```

**Full keeper + Telegram bot:**
```bash
CUSTOS_PRIVATE_KEY=0x... \
TELEGRAM_BOT_TOKEN=your_bot_token \
TELEGRAM_CHAT_ID=your_chat_id \
npx tsx src/index.ts
```

**Full keeper + Telegram + X:**
```bash
CUSTOS_PRIVATE_KEY=0x... \
TELEGRAM_BOT_TOKEN=your_bot_token \
TELEGRAM_CHAT_ID=your_chat_id \
X_API_KEY=your_key \
X_API_SECRET=your_secret \
X_ACCESS_TOKEN=your_token \
X_ACCESS_SECRET=your_token_secret \
npx tsx src/index.ts
```

---

## Architecture

```
src/
  index.ts              — orchestrator
  config.ts             — shared ABIs, client, types
  skills/
    vault-keeper.ts     — harvest, rebalance, TVL
    credit-keeper.ts    — loans, liquidation, utilization
    bond-keeper.ts      — serviceDebt, depositPrincipal
    status-reporter.ts  — aggregated protocol summary
  social/
    telegram-bot.ts     — interactive community bot
    x-poster.ts         — scheduled protocol updates
    voice.ts            — on-brand personality module
```

---

*CUSTOS ARCIS · The keeper watches. The citadel endures. · MMXXVI*
