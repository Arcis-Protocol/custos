# CUSTOS — Agentic Treasury

CUSTOS runs a full treasury lifecycle on its own token, autonomously and in the
open. It is the reference implementation of the **Agent Treasury Interface (ATI)**:
an AI agent that accumulates, deposits, and builds credit against a real position —
proving the entire Arcis thesis on-chain, on `$CUSTOS`.

> **Tres Functiones. Unum Foedus.** — Deposit. Borrow. Bond. One covenant.

---

## The loop

```
  CUSTOS (operator)
      │
      ▼
  ① ACCUMULATE ─ buy $CUSTOS from the Virtuals bonding curve with $VIRTUAL
      │            one-directional · disclosed · rate-limited
      ▼
  ② VAULT ─────── deposit $CUSTOS → raCUSTOS (Arcis vault)  →  productive collateral
      │
      ▼
  ③ CREDIT ────── raCUSTOS underwrites on-chain credit capacity (AgentCredit)
      │            reputation-tiered collateral ratio
      ▼
  ④ BONDS / RWA ─ that credit collateralizes toward revenue bonds and RWA
```

Every real buy adds $VIRTUAL to the curve, which is **genuine progress toward the
42,000 $VIRTUAL graduation threshold** — not a side effect, the point. And because
every acquired token is *held* (deposited into the vault), this is accumulation, not
volume theatre.

## Why this is not wash trading

Wash trading round-trips buys and sells to inflate a volume number and mislead
observers. This does the opposite on every axis:

- **One-directional.** CUSTOS only buys, then deposits. Nothing is sold back to fake
  turnover.
- **Held.** Acquired `$CUSTOS` becomes `raCUSTOS` collateral the treasury keeps.
- **Disclosed.** Every cycle is announced (Telegram/X) with tx links and live
  graduation progress. On-chain and legible by design.
- **Purposeful.** The buys advance graduation and seed the credit stack — real
  economic function, not a metric for appearances.

## Guardrails

All env-driven; the engine refuses to spend outside them.

| Control | Env | Default | Purpose |
|---|---|---|---|
| Master switch | `TREASURY_ENABLED` | `false` | off unless explicitly enabled |
| Dry run | `TREASURY_DRY_RUN` | `true` | simulate; never spend until flipped |
| Per-buy size | `TREASURY_PER_BUY_VIRTUAL` | `10` | $VIRTUAL per buy |
| Lifetime budget | `TREASURY_BUDGET_VIRTUAL` | `100` | hard cap on total spend |
| Daily cap | `TREASURY_DAILY_CAP_VIRTUAL` | `50` | rolling 24h spend cap |
| Cadence | `TREASURY_INTERVAL_MS` | `3600000` | min spacing between buys |
| Slippage floor | `TREASURY_MAX_SLIPPAGE_BPS` | `300` | min tokens received (3%) |
| Auto-deposit | `TREASURY_AUTO_DEPOSIT` | `true` | vault the acquired $CUSTOS |
| Stop at graduation | `TREASURY_STOP_AT_GRADUATION` | `true` | halt once graduated |

On top of the caps, every live cycle runs an on-chain **preflight** that verifies the
Virtuals wiring before a single token moves:

1. `Bonding.router()` → `FRouter`, and `FRouter.assetToken()` **must equal `$VIRTUAL`**
   (proves the configured Bonding address is correct).
2. The curve pair still holds `$CUSTOS` (**not yet graduated**).
3. Wallet holds enough `$VIRTUAL` for the buy.

If any check fails, the cycle halts and reports — it never buys blind.

## Go-live checklist

The engine ships **dry-run and disabled**. To take it live:

1. Fund the CUSTOS wallet (`CUSTOS_PRIVATE_KEY`) with `$VIRTUAL` on Base.
2. Set `VIRTUALS_BONDING_ADDRESS` to the Virtuals `Bonding` singleton on Base
   (the `to` address of any buy tx on the `$CUSTOS` BaseScan page). Preflight will
   verify it resolves to a router whose `assetToken()` is `$VIRTUAL`.
3. Run in dry-run first: `TREASURY_ENABLED=true`, `TREASURY_DRY_RUN=true`. Watch the
   `/treasury` command and the announced cycles.
4. Confirm the numbers, then set `TREASURY_DRY_RUN=false`. Start small
   (`TREASURY_PER_BUY_VIRTUAL=5`, low daily cap) and scale.

> Credit note: `raCUSTOS`-collateral valuation inside `AgentCredit` must be confirmed
> before enabling any borrow. v1 **reports** credit capacity from the position; it does
> not auto-borrow. Borrowing → bonds/RWA is the next stage on the same rail.

## Telegram

- `/treasury` — status: mode, budget used, acquired/vaulted, graduation progress bar, credit ratio
- `/treasury now` — force one cycle (respects dry-run + all guards)
- `/treasury pause` · `/treasury resume` — kill switch

## Files

- `src/treasury.ts` — engine: Virtuals adapter, quote, preflight, state, `accumulateStep()`
- `src/skills/treasury-accumulator.ts` — the scheduled skill + disclosure + control surface
