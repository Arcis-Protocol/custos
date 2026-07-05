# CUSTOS on Spectrum — messaging interface

Brings CUSTOS (and the ATI) to iMessage, WhatsApp, Telegram, and terminal via
Photon's Spectrum framework. **Phase 1 is READ-ONLY.**

> Install: `npm install spectrum-ts`  ·  Run: `npm run spectrum`

## Phase 1 — read-only (shipped)
Text CUSTOS; it answers from live chain state — vault APY, TVL, how Arcis works,
its ACP offerings. It holds no keys and **cannot move funds**: any deposit /
withdraw / borrow instruction gets a clear "not yet, and only with your own
signature." All behavior + the money guardrail live in `channels/spectrum-brain.ts`.

- **Test locally, no credentials:** `npm run spectrum` starts the `terminal`
  provider — type to CUSTOS right in your shell. Proves the whole loop, zero setup.
- **Go live on iMessage:** create a project at app.photon.codes (managed iMessage
  lines), set `PROJECT_ID` + `PROJECT_SECRET` and `SPECTRUM_IMESSAGE=true`; the iMessage provider turns on

## Phase 2 — non-custodial deposit (next)
Text "deposit 500" → CUSTOS replies with a signing link / iMessage mini-app → you
sign in **your own** wallet → the deposit lands → CUSTOS confirms with a BaseScan
link. CUSTOS never touches your keys. The "text to deposit" demo, done safely.

## Phase 3 — session-key delegation (later)
Grant CUSTOS a smart-account **session key** scoped to only the Arcis vault, with a
spending cap. A text then executes the deposit directly — pre-authorized, bounded,
still non-custodial. The true "just text it and it happens" magic (ERC-4337 / EIP-7702).

## Files
`spectrum-server.ts` (transport shim) · `channels/spectrum-brain.ts` (read-only logic + guardrail)
