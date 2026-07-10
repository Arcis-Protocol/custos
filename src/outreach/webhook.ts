// ═══════════════════════════════════════════════════════════════════════════
//  outreach/webhook.ts — receives approved outreach and posts it to X.
//
//  Point the campaign at it:  OUTREACH_MODE=webhook  OUTREACH_WEBHOOK=http://…/x
//  Each approved prospect → one concise public callout via the x-skill. (A public
//  tweet isn't the DM draft, so it's reshaped to a tweet-length, tagged callout.)
//  Guarded by OUTREACH_WEBHOOK_SECRET. Every post was already approved in Telegram.
//
//  Run:  npm run outreach:webhook
// ═══════════════════════════════════════════════════════════════════════════

import { createServer } from "http";
import { XSkill } from "../skills/x-skill.js";

const PORT = Number(process.env.OUTREACH_WEBHOOK_PORT || 8790);
const SECRET = process.env.OUTREACH_WEBHOOK_SECRET || "";
const x = new XSkill();

function tweetFor(p: any): string {
  const who = p?.handle ? `@${p.handle}` : `$${p.symbol}`;
  const idle = `$${Math.round(Number(p?.idleUsdc) || 0).toLocaleString()}`;
  return `${who} — you're holding ${idle} in idle USDC earning nothing.\n\nCUSTOS runs treasuries for agents: idle → yield, on-chain credit, non-custodial. Free snapshot, no commitment.\n\nThey built traders. We built the treasury.`;
}

createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405); return res.end("POST only"); }
  if (SECRET && req.headers["x-outreach-secret"] !== SECRET) { res.writeHead(401); return res.end("unauthorized"); }
  let body = "";
  for await (const c of req) body += c;
  try {
    const { prospect } = JSON.parse(body || "{}");
    if (!prospect?.symbol) { res.writeHead(400); return res.end("missing prospect"); }
    const text = tweetFor(prospect).slice(0, 279);
    const ok = await x.postProof(text);
    console.log(`[webhook] ${ok ? "posted" : "FAILED"} → $${prospect.symbol}`);
    res.writeHead(ok ? 200 : 502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok, tweeted: ok ? text : null }));
  } catch (e: any) { res.writeHead(400); res.end(String(e.message || "bad request")); }
}).listen(PORT, () => console.log(`[outreach-webhook] on :${PORT} — approved outreach → X`));
