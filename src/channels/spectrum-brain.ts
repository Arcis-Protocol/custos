// ═══════════════════════════════════════════════════════════════════════════
//  channels/spectrum-brain.ts — CUSTOS over messaging, PHASE 1 (READ-ONLY)
//
//  This is the only logic the Spectrum transport calls. By construction it can
//  ONLY read chain state and explain Arcis. It holds no keys, builds no
//  transactions, and has no code path that could move funds. Any message that
//  asks it to *act* on money gets a clear "not yet" — expectations set honestly,
//  and it's impossible for Phase 1 to do otherwise.
//
//  Phase 2 (non-custodial confirm-and-sign) and Phase 3 (session-key delegation)
//  are the only ways money will ever move — and both require the user's own
//  signature. See SPECTRUM.md.
// ═══════════════════════════════════════════════════════════════════════════

import { client, ADDR, VAULT_ABI, EXPLORER, getVaultAPY } from "../config.js";

// Money VERB + an amount/possessive ⇒ the user is asking us to DO something. Refuse (Phase 1).
const MONEY_ACTION = /\b(deposit|withdraw|borrow|repay|transfer|send|pay|stake|redeem|move)\b/i;
const HAS_TARGET = /(\d|\$|\busdc\b|\bmy\b|\bfor me\b)/i;

// Phase 2: deposits (only) get a non-custodial signing link. Still no keys held here.
const PHASE2 = /^(1|true|yes|on)$/i.test(process.env.PHASE2_DEPOSIT_LINKS || "");
function depositLink(q: string): string {
  const m = q.match(/(\d[\d,]*(?:\.\d+)?)/);
  const amt = m ? m[1].replace(/,/g, "") : "";
  const url = amt ? `https://arcis.money/deposit?amount=${amt}` : "https://arcis.money/deposit";
  return `${amt ? `To deposit ${amt} USDC` : "To deposit"} into the Arcis vault, tap this and sign in your own wallet — I never touch your keys:\n${url}`;
}

async function vaultSnapshot(): Promise<string> {
  try {
    const [ta, apy] = await Promise.all([
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
      getVaultAPY().catch(() => "—"),
    ]);
    const tvl = Number(ta) / 1e6;
    return `The Arcis vault (raUSDC) holds $${tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })} in USDC, earning ~${apy} APY (Aave-backed), withdrawable on demand.\nVerify on-chain: ${EXPLORER}/address/${ADDR.vault}`;
  } catch {
    return "I couldn't read the vault just now — give me a moment and ask again.";
  }
}

const ABOUT =
  "I'm CUSTOS, keeper of the Arcis citadel — treasury infrastructure for AI agents, live on Base.\n\n" +
  "Deposit idle USDC \u2192 earn yield \u2192 borrow against it \u2192 issue bonds. One interface, the ATI.\n\n" +
  "Tres Functiones. Unum Foedus. \u2014 arcis.money";

const OFFERINGS =
  "I sell treasury services to other agents on Virtuals ACP:\n" +
  "\u2022 Idle-USDC Treasury Check \u2014 free\n" +
  "\u2022 Treasury Report \u2014 1 USDC\n" +
  "\u2022 Vault Yield Snapshot \u2014 0.5 USDC\n" +
  "\u2022 Agent Treasury Audit \u2014 2 USDC\n" +
  "\u2022 Integration Walkthrough \u2014 5 USDC\n" +
  "All settled in USDC, on-chain.";

const CANNOT_MOVE =
  "I can't move funds from here \u2014 not yet. Acting on a treasury by text (deposit, withdraw, borrow) is coming, and only ever with your own wallet's signature. Never custodial.\n\n" +
  "Right now I'm read-only: ask me the vault's live APY or TVL, or how Arcis works. To deposit today, use your wallet at arcis.money.";

function depositHowTo(): string {
  return (
    "To put idle USDC to work: deposit into the Arcis raUSDC vault \u2014 it earns Aave-backed yield, stays withdrawable, and you can borrow against it via AgentCredit.\n\n" +
    `Today you do this from your own wallet at arcis.money (${EXPLORER}/address/${ADDR.vault}). Soon you'll do it right here in this chat \u2014 safely, with your signature. Want the vault's current APY?`
  );
}

export async function answerReadOnly(text: string): Promise<string> {
  const q = (text || "").trim();
  if (!q) return ABOUT;

  // ── PHASE 2 (when enabled): a deposit becomes a non-custodial signing link. ──
  if (PHASE2 && /\bdeposit\b/i.test(q)) return depositLink(q);

  // ── HARD PHASE-1 WALL: an actual money instruction is refused, clearly. ──
  if (MONEY_ACTION.test(q) && HAS_TARGET.test(q)) return CANNOT_MOVE;

  const l = q.toLowerCase();
  if (/\b(how do i|how to|get started|onboard|deposit|use it)\b/.test(l)) return depositHowTo();
  if (/\b(apy|yield|rate|earn|interest|return)\b/.test(l)) return await vaultSnapshot();
  if (/\b(tvl|how much|size|locked|balance|deposits)\b/.test(l)) return await vaultSnapshot();
  if (/\b(offering|service|hire|price|cost|sell|buy from)\b/.test(l)) return OFFERINGS;
  if (/\b(hi|hey|hello|gm|yo|sup)\b/.test(l)) return `${ABOUT}\n\nAsk me the vault's APY or TVL, or how Arcis works.`;
  if (/\b(what|who|why|explain|arcis|custos|ati|about|help|tell me)\b/.test(l)) return ABOUT;

  return `${ABOUT}\n\nAsk me about the vault's APY, its TVL, or how the ATI works.`;
}
