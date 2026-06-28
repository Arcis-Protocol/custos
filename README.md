# CUSTOS

**The Keeper of the Citadel.**

Autonomous keeper and community agent for Arcis Protocol. Live on Base mainnet. 7 contracts deployed. 9 skills. Harvests yield, monitors health, services debt, engages community, posts insights, and narrates protocol operations.

---

## Keeper Skills

| Skill | Interval | What It Does |
|---|---|---|
| VaultKeeper | 5 min | harvest, rebalance, TVL monitoring, invariant checks |
| CreditKeeper | 1 min | loan scanning, liquidation, utilization alerts |
| BondKeeper | 10 min | serviceDebt, depositPrincipal, default detection |
| StatusReporter | 1 hour | aggregated multi-skill protocol summary |

## Social Skills

| Skill | Interval | What It Does |
|---|---|---|
| TelegramSkill | 2 sec | interactive bot — commands, natural language, live data |
| XSkill | 4 hours | scheduled posts — status updates and thesis commentary |
| NarratorSkill | 30 sec | real-time keeper action narration across channels |
| InsightSkill | 1 hour | data-driven protocol insights, educational content |
| EngagementSkill | 10 min | TVL milestones, ATH tracking, daily briefings |

---

## Telegram Commands

```
/status   Full protocol overview
/vault    TVL, exchange rate, capacity
/credit   Lending pool, utilization
/bonds    Revenue bond status
/ati      Agent Treasury Interface spec
/help     Command list
```

Natural language: ask about TVL, rates, loans, what Arcis is, or say gm.

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

**Full keeper + all social:**
```bash
CUSTOS_PRIVATE_KEY=0x... \
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_CHAT_ID=... \
X_API_KEY=... \
X_API_SECRET=... \
X_ACCESS_TOKEN=... \
X_ACCESS_SECRET=... \
npx tsx src/index.ts
```

Missing credentials disable individual skills gracefully.

---

## Architecture

```
src/
  index.ts                  — orchestrator (9 skills)
  config.ts                 — ABIs, client, Skill interface
  skills/
    vault-keeper.ts         — harvest, rebalance, TVL
    credit-keeper.ts        — loans, liquidation, utilization
    bond-keeper.ts          — serviceDebt, depositPrincipal
    status-reporter.ts      — aggregated protocol summary
    telegram-skill.ts       — interactive community bot
    x-skill.ts              — scheduled protocol posts
    narrator-skill.ts       — real-time keeper narration
    insight-skill.ts        — protocol insights, education
    engagement-skill.ts     — milestones, ATH, daily briefing
  social/
    voice.ts                — on-brand personality module
```

---

*CUSTOS ARCIS · The keeper watches. The citadel endures. · MMXXVI*
