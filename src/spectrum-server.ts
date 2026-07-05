// @ts-nocheck — thin Spectrum transport shim. Types resolve after `npm install spectrum-ts`.
// ═══════════════════════════════════════════════════════════════════════════
//  spectrum-server.ts — CUSTOS on Spectrum (iMessage / WhatsApp / Telegram / terminal)
//
//  PHASE 1: READ-ONLY. Run:  npm run spectrum
//
//  • Local test, zero credentials: uses the `terminal` provider — just type in
//    your terminal and CUSTOS replies. Proves the whole loop with no iMessage setup.
//  • iMessage / WhatsApp: set PROJECT_ID + PROJECT_SECRET (from app.photon.codes,
//    Photon's managed lines) and the provider(s) get added automatically below.
//
//  The transport is deliberately dumb: it extracts the incoming text, hands it to
//  answerReadOnly(), and sends the reply back. All behavior + the money guardrail
//  live in channels/spectrum-brain.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { Spectrum } from "spectrum-ts";
import { terminal, imessage, telegram, whatsapp } from "spectrum-ts/providers";
import { answerReadOnly } from "./channels/spectrum-brain.js";

async function main() {
  const cloud = Boolean(process.env.PROJECT_ID && process.env.PROJECT_SECRET);

  const providers = [terminal.config()];
  if (cloud) {
    providers.push(imessage.config());
    if (process.env.SPECTRUM_WHATSAPP === "true") providers.push(whatsapp.config());
    if (process.env.SPECTRUM_TELEGRAM === "true") providers.push(telegram.config());
  }

  const app = await Spectrum({
    projectId: process.env.PROJECT_ID || "local",
    projectSecret: process.env.PROJECT_SECRET || "local",
    providers,
  });

  console.log(`CUSTOS on Spectrum \u2014 READ-ONLY (Phase 1). ${cloud ? "iMessage line active." : "Terminal only (no cloud creds)."} Type to CUSTOS:`);

  for await (const [space, message] of app.messages) {
    try {
      if (message?.type && message.type !== "text") continue;
      const text =
        typeof message?.content === "string" ? message.content : (message?.content?.text ?? message?.text ?? "");

      const reply = await answerReadOnly(text);

      if (space?.responding && typeof message?.reply === "function") {
        await space.responding(() => message.reply(reply));
      } else if (typeof message?.reply === "function") {
        await message.reply(reply);
      } else {
        await space.send(reply);
      }
    } catch (e) {
      console.error("spectrum message error:", e);
      try { await space.send("Something went wrong reading that \u2014 try again in a moment."); } catch {}
    }
  }
}

main().catch((e) => { console.error("spectrum fatal:", e); process.exit(1); });
