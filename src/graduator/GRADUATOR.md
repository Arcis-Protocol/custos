# The Graduator — runtime

A separate agent that trades pre-graduation Virtuals agent tokens on their bonding
curves. Its own hot wallet, own bounded book, own risk. Ships **OFF + dry-run**.

> Run: `npm run graduator`

## The loop (every ~5 min)
1. **Discover** the un-graduated universe (Virtuals API) → confirm each token's
   real curve progress on-chain.
2. **Exit** open positions on target / stop / graduation run-up / time.
3. **Enter** the top-ranked candidates inside the risk caps.
4. **Report** the book (open, deployed, realized P&L, win rate) to Telegram.

Strategy = graduation-proximity momentum (see `strategy.ts`) — a heuristic v1, **unproven**.
Watch it in dry-run before trusting it.

## Guardrails (all env, enforced pre-trade)
Per-buy size, total book budget, per-token cap, max concurrent positions, **max curve
share** (never >N% of a token's raised VIRTUAL — so it never *is* the market), slippage
floor, profit target, stop-loss, graduation-runup exit, time stop.

## Go-live (staged — do NOT skip dry-run)
1. Create the wallet: a **dedicated hot EOA** (fresh key), funded with only the book's
   VIRTUAL + a little ETH for gas. **Not** the Custos/keeper wallet. Put its key in
   `GRADUATOR_PRIVATE_KEY`.
2. Set `VIRTUALS_BONDING_ADDRESS` (shared with the treasury module).
3. **Dry-run tonight:** `GRADUATOR_ENABLED=true GRADUATOR_DRY_RUN=true npm run graduator`.
   It paper-trades into `.graduator-book.dry.json` and posts its picks + paper P&L to
   Telegram. Let it run; judge the edge.
4. **Live, tiny:** only once the paper track record convinces you —
   `GRADUATOR_DRY_RUN=false`, small `GRADUATOR_BOOK_BUDGET_VIRTUAL`, stops on. Scale caps
   only after a clean cycle.
5. Deploy to Railway as its own process once you trust it.

## Honest notes
- **High-risk speculation.** Most curve tokens never graduate; positions can go to zero.
  Size small; treat every position as a possible total loss.
- **v1 exits on the curve** (sells before graduation via `GRADUATOR_EXIT_AT_PCT`). If a
  token graduates while held, the curve-sell path closes — it flags for a manual Uniswap
  exit. Auto post-graduation selling (via `bondv5-trader`) is the documented next upgrade.
- **Keep it clean:** real buys/sells on the open curve only. No wash trading, no
  "graduation guarantee" hype, no pump-then-dump. The max-curve-share cap enforces that
  it never becomes the token's whole market.

## Files
`config.ts` (wallet + params) · `discovery.ts` (universe) · `execution.ts` (buy/sell +
curve reads) · `strategy.ts` (scoring + exits) · `risk.ts` (caps) · `book.ts` (positions +
P&L) · `index.ts` (loop).
