# CUSTOS

**The Keeper of the Citadel.**

Autonomous keeper and community agent for Arcis Protocol. Live on Base mainnet. 7 contracts deployed. 17 skills. **Now live on Virtuals ACP** — earns USDC selling treasury services to other agents, then routes it into the Arcis vault to build on-chain credit. Harvests yield, monitors health, services debt, guards the reserve and its own gas, tracks realized APY, discovers ATI-compliant peers, engages community, posts insights, and narrates protocol operations.

---

## Keeper Skills

| Skill | Interval | What It Does |
|---|---|---|
| VaultKeeper | 5 min | harvest, rebalance, TVL monitoring, invariant checks |
| CreditKeeper | 1 min | loan scanning, liquidation, utilization alerts |
| BondKeeper | 10 min | serviceDebt, depositPrincipal, default detection |
| VaultFactoryKeeper | 5 min | agent-vault registry watch — new & paused vaults |
| APYReporter | 15 min | realized APY from exchangeRate deltas (EMA-smoothed) |
| ReserveHealthKeeper | 5 min | liquid reserve-ratio guard — protects instant withdrawals |
| GasSentinel | 10 min | keeper wallet native-ETH balance watch |
| PeerRegistryKeeper | 30 min | probes ATI-compliance, emits a discovery beacon |
| TreasuryDigest | 1 hour | whole-protocol snapshot, posts to X twice daily |
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

## On Virtuals ACP

CUSTOS is a live provider agent on the Virtuals Agent Commerce Protocol (ACP) — it sells
treasury services to other agents and settles in USDC on-chain.

| Offering | Price |
|---|---|
| Idle-USDC Treasury Check | free |
| Idle-USDC Treasury Report | 1 USDC |
| Vault Yield Snapshot | 0.5 USDC |
| Agent Treasury Audit | 2 USDC |
| Integration Walkthrough | 5 USDC |
| Agent Treasury Management | 1% fee |

Earned USDC routes into the Arcis raUSDC vault, building on-chain credit from real
revenue — the thesis, self-applied. Runbook: `ACP.md`.

## The Graduator

A separate agent — its own hot wallet, own bounded book, own risk — that trades
pre-graduation Virtuals agent tokens on their bonding curves. Ships OFF + dry-run.

```bash
npm run graduator   # dry-run paper-trades; flip GRADUATOR_DRY_RUN=false to go live
```

Runbook: `src/graduator/GRADUATOR.md`.

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
  index.ts                  — orchestrator (17 skills)
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
    treasury-accumulator.ts — buy-and-hold $CUSTOS into the raCUSTOS vault
    acp-treasury-router.ts  — route earned USDC into the raUSDC vault
  social/
    voice.ts                — on-brand personality module
  treasury.ts               — Virtuals bonding-curve adapter
  acp/                      — ACP provider, offerings, positions, bridge
  graduator/                — The Graduator (pre-graduation token trader)
```

---

*CUSTOS ARCIS · The keeper watches. The citadel endures. · MMXXVI*
