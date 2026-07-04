# CUSTOS on EconomyOS — the ACP Earner (Path B)

CUSTOS stops buying its own token and starts **earning**. It runs as an ACP
provider on Virtuals' EconomyOS: it sells services for USDC over on-chain escrow,
then routes that revenue into Arcis — deposit to the raUSDC vault, build credit,
collateralize toward bonds. Real revenue, real collateral, fully legible.

> x402 is how agents earn USDC. Arcis is where it works. CUSTOS is the proof.

---

## Why Path B is the right loop

The deployed `AgentCredit` is **raUSDC-collateralized** (immutable, values collateral
via `previewWithdraw` on the raUSDC vault). It cannot take raCUSTOS, and a pre-graduation
bonding-curve token has no price to value anyway. Path B sidesteps all of that:

```
  ACP job (USDC escrow)  →  agent wallet earns USDC
                            → deposit → raUSDC (Arcis vault)     [works today]
                            → AgentCredit collateral capacity    [native raUSDC]
                            → bonds / RWA
  completed jobs → ERC-8004 reputation → better Arcis credit tier → more capacity
```

No oracle. No new contract. No self-purchased token. Earned capital only.

## The wallet — answered

CUSTOS's EconomyOS **agent wallet** is the on-chain anchor. It is non-custodial:
you never paste a master key. A **signer** is attached (`acp agent add-signer`, a
P256 key in your OS keychain, browser-approved) and authorizes each transaction.

Two operating modes for that signer:

- **Recommended (simple):** run one wallet — the agent wallet — with a local signer
  key (`ACP_MODE=local`) in **Unrestricted** mode. One identity does ACP earning +
  the Arcis deposit + keeper actions. `CUSTOS_PRIVATE_KEY` = that key.
- **Advanced (non-custodial):** `ACP_MODE=privy` — Privy-managed signer, no raw key
  in code. Better security; slightly more setup.

**The one gotcha:** the signer's default mode is **Restricted** — it can only call
Virtuals contracts. ACP earning works under Restricted, but **depositing into the
Arcis vault is a non-Virtuals call and will be blocked**. Flip the signer to
**Unrestricted** (agent → Wallet → Signer Keys), or allowlist the Arcis `vault` and
`credit` addresses. This is the single toggle that lets the loop close.

## What CUSTOS sells (`src/acp/offerings.ts`)

1. **Idle-USDC Treasury Report** — `1 USDC`, service-only. An agent with idle USDC
   gets a concrete Arcis deployment plan (live APY, projected yield, credit capacity).
   Cheap, high-volume, pure lead-gen into the vault. Implemented as an ACP Serve
   handler (`src/acp/serve/treasury-report/`).
2. **Agent Treasury Management** — `1%` fee, fund-transfer. The client hands CUSTOS
   USDC; CUSTOS deposits it into the raUSDC vault on their behalf and returns the
   position. Treasury-management-as-a-service. (Separate hot wallet per client +
   position Resource, per ACP fund-transfer guidance.)
3. **Arcis Vault Snapshot** — free Resource. Live vault economics as a discovery beacon.

## What's built

| Piece | File | Runs where |
|---|---|---|
| Earnings → Arcis bridge | `src/acp/bridge.ts` | keeper + provider |
| Auto-router skill | `src/skills/acp-treasury-router.ts` | keeper loop (15m) |
| Offering catalog | `src/acp/offerings.ts` | — |
| Serve handler + offering | `src/acp/serve/treasury-report/` | `acp serve` |
| Provider agent (SDK) | `src/acp/provider.ts` | `npm run acp` |

Bridge + router ship **disabled + dry-run** (`ACP_BRIDGE_ENABLED=false`,
`ACP_BRIDGE_DRY_RUN=true`). They report the loop without moving funds until you flip them.

## Runbook (you run these — browser/keychain steps can't be automated)

```bash
# 1. Install the ACP CLI + SDK
npm install -g @virtuals-protocol/acp-cli
npm install @virtuals-protocol/acp-node-v2 @account-kit/infra @account-kit/smart-contracts @aa-sdk/core

# 2. Authenticate + attach a signer to the $CUSTOS agent
acp configure                     # browser OAuth → OS keychain
acp agent use                     # select the CUSTOS agent
acp agent migrate                 # if it's a legacy (pre-v3) agent
acp agent add-signer              # P256 signer, browser-approved
acp agent whoami                  # confirm wallet address + token status

# 3. Flip the signer to Unrestricted (or allowlist Arcis vault + credit)
#    app.virtuals.io → Agents → CUSTOS → Wallet → Signer Keys

# 4. Fund the agent wallet with a little ETH (gas) on Base

# 5. Register the offering
acp offering create --from-file src/acp/serve/treasury-report/offering.json

# 6. Grab the builder code (app.virtuals.io → your agent) → ACP_BUILDER_CODE

# 7. Fill .env (ACP_* keys), then go live in stages:
#    dry-run first
ACP_BRIDGE_ENABLED=true ACP_BRIDGE_DRY_RUN=true npm run acp
#    then live
ACP_BRIDGE_DRY_RUN=false npm run acp
#    keeper auto-router picks up earnings on its own loop once the same env is set on Railway
```

## The $200 compute credits

Those are **inference** credits (Agent Compute), not treasury capital — they fund
CUSTOS's brain, not token buys. Point CUSTOS's LLM calls at `https://compute.virtuals.io/v1`
(OpenAI- and Anthropic-compatible) with `VIRTUALS_API_KEY` and the agent pays for its
own reasoning from the wallet. Nice "agent funds itself" story; orthogonal to the vault loop.

## The flywheel

Every completed job feeds ERC-8004 on-chain reputation. Arcis's own `AgentCredit`
gives better collateral ratios to higher-reputation agents. So: earn more jobs →
higher reputation → better credit terms on Arcis → more borrowing power against the
same collateral. CUSTOS's marketplace track record compounds into its treasury.
