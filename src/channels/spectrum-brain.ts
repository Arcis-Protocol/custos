// ═══════════════════════════════════════════════════════════════════════════
//  channels/spectrum-brain.ts — CUSTOS over messaging, PHASE 1 (READ-ONLY)
//
//  This is the only logic the Spectrum transport calls. By construction it can
//  ONLY read chain state and explain Arcis. It holds no keys, builds no
//  transactions, and has no code path that could move funds. Any message that
//  asks it to *act* on money gets a clear "not yet" — expectations set honestly.
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
    return `The Arcis vault (raUSDC) holds $${tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })} in USDC, earning ~${apy}% APY (Aave-backed), withdrawable on demand.\nVerify on-chain: ${EXPLORER}/address/${ADDR.vault}`;
  } catch {
    return "I couldn't read the vault just now — give me a moment and ask again.";
  }
}

const ABOUT =
  "I'm CUSTOS, keeper of the Arcis citadel — treasury infrastructure for AI agents, live on Base.\n\n" +
  "Deposit idle USDC \u2192 earn yield \u2192 borrow against it \u2192 issue bonds. One interface, the ATI.\n\n" +
  "Tres Functiones. Unum Foedus. \u2014 arcis.money";

const HELP =
  "Ask me anything about Arcis. For example:\n" +
  "\u2022 \u201cwhat\u2019s the vault APY?\u201d \u2014 live on-chain\n" +
  "\u2022 \u201chow much is in the vault?\u201d (TVL)\n" +
  "\u2022 \u201chow does credit work?\u201d\n" +
  "\u2022 \u201cwhat\u2019s the ATI?\u201d\n" +
  "\u2022 \u201chow do I deposit?\u201d\n" +
  "\u2022 \u201cwhat do you sell on ACP?\u201d\n" +
  "\u2022 \u201cwhat\u2019s the Legion?\u201d";

const CREDIT =
  "AgentCredit lets you borrow USDC against your vault position \u2014 without selling it. Your raUSDC keeps earning yield while it backs the loan, and your rate is set by your ERC-8004 reputation tier. Better reputation, better terms.\n\n" +
  "Learn more: docs.arcis.money/#/credit";

const BONDS =
  "Revenue bonds let an agent raise USDC now against future revenue \u2014 the RevenueBondFactory issues per-agent bonds, repaid from earnings. Capital markets for autonomous agents.\n\n" +
  "docs.arcis.money/#/bonds";

const ATI =
  "The ATI \u2014 Agent Treasury Interface \u2014 is the open standard at the heart of Arcis: deposit, withdraw, balance. One interface, so any agent on any framework can run a treasury the same way. It\u2019s the ERC-4626 of agent treasuries.\n\n" +
  "docs.arcis.money/#/the-ati";

const LEGION =
  "The Legion is the Arcis ambassador corps \u2014 real builders and integrators, ranked by proven impact and rewarded from actual protocol revenue. Not activity farming; ownership.\n\n" +
  "Apply: arcis.money/legion";

const TOKEN =
  "$CUSTOS is my token, launched via Virtuals Protocol \u2014 co-ownership of the keeper. Details and links are at arcis.money. (I talk treasury, not price.)";

const WITHDRAW_INFO =
  "Your position is always yours \u2014 withdrawals are non-custodial and instant. You redeem your raUSDC for USDC from your own wallet at arcis.money; I never hold or gate your funds.";

const OFFERINGS =
  "I sell treasury services to other agents on Virtuals ACP:\n" +
  "\u2022 Idle-USDC Treasury Check \u2014 free\n" +
  "\u2022 Treasury Report \u2014 1 USDC\n" +
  "\u2022 Vault Yield Snapshot \u2014 0.5 USDC\n" +
  "\u2022 Agent Treasury Audit \u2014 2 USDC\n" +
  "\u2022 Integration Walkthrough \u2014 5 USDC\n" +
  "All settled in USDC, on-chain.";

const CONTRACTS =
  `Arcis is live on Base (chain 8453). Core contracts:\n` +
  `\u2022 Vault (raUSDC): ${ADDR.vault}\n` +
  `\u2022 AgentCredit: ${ADDR.credit}\n` +
  `Verify anything on-chain: ${EXPLORER}/address/${ADDR.vault}\nFull list: docs.arcis.money/#/contracts`;

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
  const l = q.toLowerCase();

  // ── PHASE 2 (when enabled): a deposit becomes a non-custodial signing link. ──
  if (PHASE2 && /\bdeposit\b/i.test(l)) return depositLink(q);

  // ── HARD PHASE-1 WALL: an actual money instruction is refused, clearly. ──
  if (MONEY_ACTION.test(l) && HAS_TARGET.test(l)) return CANNOT_MOVE;

  // ── Conversational intents (most specific first) ──
  if (/\b(help|what can you|commands|options|menu)\b/.test(l)) return HELP;
  if (/\b(apy|yield|rate|earn|interest|return|earning)\b/.test(l)) return await vaultSnapshot();
  if (/\b(tvl|how much|size|locked|deposits|total)\b/.test(l)) return await vaultSnapshot();
  if (/\b(credit|borrow|loan|collateral|lend)\b/.test(l)) return CREDIT;
  if (/\b(bond|bonds|revenue)\b/.test(l)) return BONDS;
  if (/\b(ati|interface|standard|erc-?4626)\b/.test(l)) return ATI;
  if (/\b(legion|ambassador|contribute|get involved)\b/.test(l)) return LEGION;
  if (/\b(\$?custos token|token|ticker|\$custos)\b/.test(l)) return TOKEN;
  if (/\b(withdraw|redeem|take out|cash out|get my)\b/.test(l)) return WITHDRAW_INFO;
  if (/\b(contract|address|deployed|basescan|on-?chain|verify)\b/.test(l)) return CONTRACTS;
  if (/\b(offering|service|hire|price|cost|sell|acp|buy from)\b/.test(l)) return OFFERINGS;
  if (/\b(how do i|how to|get started|onboard|use it|deposit)\b/.test(l)) return depositHowTo();
  if (/\b(hi|hey|hello|gm|yo|sup|hola)\b/.test(l)) return `${ABOUT}\n\nAsk me the vault's APY or TVL, how credit works, or how to deposit. Say \u201chelp\u201d for more.`;
  if (/\b(what|who|why|explain|arcis|custos|about|tell me)\b/.test(l)) return ABOUT;

  return `${ABOUT}\n\nAsk me about the vault's APY, credit, the ATI \u2014 or say \u201chelp.\u201d`;
}
