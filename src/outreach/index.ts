// ═══════════════════════════════════════════════════════════════════════════
//  outreach/index.ts — CUSTOS runs outreach, you approve each send in Telegram.
//
//  Flow (automated, human-gated):
//   1. Read the ranked book (prospects.json from `npm run prospect`).
//   2. Take the next batch of NEW prospects (deduped against outreach-state.json).
//   3. For each, DM the owner a draft with [✓ Approve & send] [✗ Skip] buttons.
//   4. Poll Telegram; on Approve → dispatch; on Skip → record. Persist state.
//
//  Honest note on channels: ACP is buyer→seller commerce, not a cold-DM rail, so
//  nothing blasts. Dispatch modes: dry (default, sends nothing), webhook (pipe to
//  your own sender), acp (open a job-room via the acp CLI — commerce-shaped, gated).
//
//  Run:  npm run outreach     ·  or  npm run campaign  (scan + outreach)
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
const pexec = promisify(execFile);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const OWNER = process.env.TELEGRAM_CHAT_ID || "778984821";
const BATCH = Number(process.env.OUTREACH_BATCH || 8);        // approvals requested per run
const WINDOW = Number(process.env.OUTREACH_WINDOW || 3600);   // seconds to wait for taps
const MODE = (process.env.OUTREACH_MODE || "dry").toLowerCase(); // dry | webhook | acp
const WEBHOOK = process.env.OUTREACH_WEBHOOK || "";
const OFFERING = process.env.OUTREACH_ACP_OFFERING || "treasury-snapshot";
const DIR = process.env.PROSPECT_OUT || ".";
const STATE = `${DIR}/outreach-state.json`;

interface Prospect { id: number; symbol: string; wallet: string; idleUsdc: number; yieldPerYr: number; draft: string; }
interface State { sent: Record<string, any>; skipped: Record<string, any>; }

const loadState = (): State => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { sent: {}, skipped: {} }; } };
const saveState = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const loadProspects = (): Prospect[] => { try { return JSON.parse(fs.readFileSync(`${DIR}/prospects.json`, "utf8")).prospects || []; } catch { return []; } };
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

async function tg(method: string, body: any): Promise<any> {
  try { return await (await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(); }
  catch { return null; }
}

async function requestApproval(p: Prospect): Promise<void> {
  const text = `*Outreach approval — $${p.symbol}*\n${usd(p.idleUsdc)} idle · ~${usd(p.yieldPerYr)}/yr on the table\n\`${p.wallet}\`\n\n${p.draft}`;
  await tg("sendMessage", {
    chat_id: OWNER, text, parse_mode: "Markdown", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "✓ Approve & send", callback_data: `ok:${p.id}` }, { text: "✗ Skip", callback_data: `no:${p.id}` }]] },
  });
}

async function dispatch(p: Prospect): Promise<string> {
  if (MODE === "webhook" && WEBHOOK) {
    try { await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect: p, draft: p.draft }) }); return "webhook"; }
    catch (e: any) { return "webhook-failed"; }
  }
  if (MODE === "acp") {
    // ACP is commerce-shaped: open a job-room with the prospect via the CLI so the pitch lands in a real channel.
    try { await pexec("acp", ["job", "create", p.wallet, OFFERING, "--requirements", JSON.stringify({ note: p.draft.slice(0, 500) })]); return "acp-room"; }
    catch (e: any) { return "acp-failed:" + String(e.message || "").slice(0, 50); }
  }
  return "dry"; // default — records approval, sends nothing
}

async function main() {
  if (!BOT_TOKEN) { console.error("TELEGRAM_BOT_TOKEN unset — cannot request approvals. Set it and re-run."); process.exit(1); }
  const state = loadState();
  const prospects = loadProspects();
  if (!prospects.length) { console.error("No prospects.json found — run `npm run prospect` first."); process.exit(1); }

  const fresh = prospects.filter((p) => !state.sent[p.id] && !state.skipped[p.id]).slice(0, BATCH);
  if (!fresh.length) { console.log("No new prospects to contact — the book is worked through."); return; }

  await tg("sendMessage", { chat_id: OWNER, text: `*CUSTOS outreach* — ${fresh.length} prospects up for approval (mode: ${MODE}). Tap to send.`, parse_mode: "Markdown" });
  const pending = new Map<number, Prospect>();
  for (const p of fresh) { await requestApproval(p); pending.set(p.id, p); await new Promise((r) => setTimeout(r, 350)); }
  console.log(`Requested approval for ${pending.size}. Waiting up to ${WINDOW}s for taps…`);

  let offset = 0;
  const deadline = Date.now() + WINDOW * 1000;
  while (pending.size && Date.now() < deadline) {
    const u = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["callback_query"] });
    for (const upd of u?.result || []) {
      offset = upd.update_id + 1;
      const cb = upd.callback_query;
      if (!cb) continue;
      const [act, idStr] = String(cb.data || "").split(":");
      const id = Number(idStr);
      const p = pending.get(id);
      if (!p) { await tg("answerCallbackQuery", { callback_query_id: cb.id }); continue; }
      if (act === "ok") {
        const via = await dispatch(p);
        state.sent[id] = { symbol: p.symbol, wallet: p.wallet, at: new Date().toISOString(), via };
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Approved" });
        await tg("editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: `✅ *$${p.symbol}* — sent (${via})`, parse_mode: "Markdown" });
      } else {
        state.skipped[id] = { symbol: p.symbol, at: new Date().toISOString() };
        await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Skipped" });
        await tg("editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: `⏭️ *$${p.symbol}* — skipped`, parse_mode: "Markdown" });
      }
      pending.delete(id);
      saveState(state);
    }
  }
  saveState(state);
  const stillPending = [...pending.values()].map((p) => `$${p.symbol}`).join(", ");
  console.log(`Done. sent=${Object.keys(state.sent).length} skipped=${Object.keys(state.skipped).length}${pending.size ? ` pending=${pending.size} (${stillPending})` : ""}`);
  if (pending.size) await tg("sendMessage", { chat_id: OWNER, text: `${pending.size} left un-actioned — I'll re-ask next run.` });
}

main().catch((e) => { console.error("outreach fatal:", e); process.exit(1); });
