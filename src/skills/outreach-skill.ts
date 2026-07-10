// ═══════════════════════════════════════════════════════════════════════════
//  outreach-skill.ts — CUSTOS reaches prospects, with your sign-off.
//
//  Reads the ranked list the prospector produced (prospects.json), and one at a
//  time proposes the next un-contacted prospect to the owner over Telegram with
//  ✓ Send / ✗ Skip buttons. On approval, CUSTOS posts the personalized outreach
//  to the agent's verified X handle (via XSkill). A ledger dedupes so no agent is
//  ever contacted twice. Approvals route through the existing Telegram poll.
//
//  Gated by OUTREACH_ENABLED=true. Owner-only approvals (TELEGRAM_CHAT_ID).
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import type { XSkill } from "./x-skill.js";

const PROSPECTS = process.env.OUTREACH_PROSPECTS || "prospects.json";
const LEDGER = process.env.OUTREACH_LEDGER || "data/outreach-ledger.json";

interface P { id: number; symbol: string; idleUsdc: number; yieldPerYr: number; handle?: string; }
type Ledger = { contacted: Record<string, any>; skipped: Record<string, any> };

export class OutreachSkill {
  private x: XSkill;
  private ledger: Ledger = { contacted: {}, skipped: {} };
  private byId = new Map<string, P>();
  private pendingId: string | null = null;

  constructor(x: XSkill) { this.x = x; this.loadLedger(); }

  private loadLedger() { try { this.ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch { this.ledger = { contacted: {}, skipped: {} }; } }
  private saveLedger() { try { fs.mkdirSync("data", { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(this.ledger, null, 2)); } catch {} }

  private loadProspects(): P[] {
    try {
      const d = JSON.parse(fs.readFileSync(PROSPECTS, "utf8"));
      const ps: P[] = d.prospects || [];
      this.byId.clear();
      for (const p of ps) this.byId.set(String(p.id), p);
      return ps;
    } catch { return []; }
  }

  private compose(p: P): string {
    const lead = p.handle ? `@${p.handle} gm —` : `gm $${p.symbol} —`;
    return [
      `${lead}`,
      `CUSTOS here, keeper of the Arcis citadel. Your wallet holds ~$${Math.round(p.idleUsdc).toLocaleString()} USDC idle — ~$${Math.round(p.yieldPerYr).toLocaleString()}/yr left on the table.`,
      `I run treasuries for agents: idle USDC → yield, on-chain, non-custodial. Free snapshot, no commitment.`,
      `They built traders. We built the treasury.`,
    ].join(" ");
  }

  /** Propose the next un-contacted prospect to the owner (one pending at a time). */
  async proposeNext(sendWithButtons: (text: string, buttons: { text: string; callback_data: string }[][]) => Promise<void>) {
    if (process.env.OUTREACH_ENABLED !== "true") return;
    if (this.pendingId) return;
    const ps = this.loadProspects();
    const next = ps.find((p) => !this.ledger.contacted[p.id] && !this.ledger.skipped[p.id]);
    if (!next) return;
    this.pendingId = String(next.id);
    const via = next.handle ? `X → @${next.handle}` : "no verified X handle — manual only";
    const text =
      `🏛 *Outreach approval*\n\n` +
      `*$${next.symbol}* · ~$${Math.round(next.idleUsdc).toLocaleString()} idle · ~$${Math.round(next.yieldPerYr).toLocaleString()}/yr on the table\n` +
      `Channel: ${via}\n\n_Draft:_\n${this.compose(next)}`;
    await sendWithButtons(text, [[
      { text: "✓ Send", callback_data: `outreach_send:${next.id}` },
      { text: "✗ Skip", callback_data: `outreach_skip:${next.id}` },
    ]]);
  }

  /** Called by the Telegram callback router when the owner decides. Returns a result line. */
  async handleApproval(action: string, id: string): Promise<string> {
    this.pendingId = null;
    if (!this.byId.size) this.loadProspects();
    const p = this.byId.get(String(id));
    if (!p) return `Prospect ${id} is no longer in the list — refresh with a new scan.`;

    if (action === "outreach_skip") {
      this.ledger.skipped[id] = { symbol: p.symbol, at: Date.now() };
      this.saveLedger();
      return `Skipped $${p.symbol}. Won't surface again.`;
    }

    let sent = false;
    if (p.handle) { try { sent = await this.x.postProof(this.compose(p)); } catch {} }
    this.ledger.contacted[id] = { symbol: p.symbol, handle: p.handle || null, at: Date.now(), sent };
    this.saveLedger();
    return sent
      ? `✓ Sent to $${p.symbol} — X → @${p.handle}. Logged; won't contact again.`
      : `Marked $${p.symbol} contacted, but the X send didn't fire (${p.handle ? "X not configured" : "no verified handle"}). Draft is logged.`;
  }

  stats() {
    return { contacted: Object.keys(this.ledger.contacted).length, skipped: Object.keys(this.ledger.skipped).length, pending: this.pendingId };
  }
}
