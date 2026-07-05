// @ts-nocheck — thin Spectrum transport shim. Types resolve after `npm install spectrum-ts`.
// ═══════════════════════════════════════════════════════════════════════════
//  spectrum-server.ts — CUSTOS on Spectrum (terminal / iMessage / …)
//
//  PHASE 1: READ-ONLY. Run:  npm run spectrum
//
//  • Local terminal test — ZERO credentials: no PROJECT_ID set ⇒ runs the
//    `terminal` provider only. Type to CUSTOS right in your shell.
//  • iMessage (managed lines) — set PROJECT_ID + PROJECT_SECRET from
//    app.photon.codes and SPECTRUM_IMESSAGE=true.
//
//  All behavior + the money guardrail live in channels/spectrum-brain.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { Spectrum } from "spectrum-ts";
import { terminal, imessage } from "spectrum-ts/providers";
import { answerReadOnly } from "./channels/spectrum-brain.js";

function extractText(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c[0]?.text) return c[0].text;      // legacy Content[]
  if (c && typeof c === "object" && typeof c.text === "string") return c.text;
  if (typeof message?.text === "string") return message.text;
  return "";
}

async function main() {
  const projectId = process.env.PROJECT_ID;
  const projectSecret = process.env.PROJECT_SECRET;
  const cloud = Boolean(projectId && projectSecret);

  const providers = [terminal.config()];
  if (cloud && process.env.SPECTRUM_IMESSAGE === "true") providers.push(imessage.config());

  // Cloud creds only when we actually have them; otherwise local terminal only.
  const app = await Spectrum(cloud ? { projectId, projectSecret, providers } : { providers });

  console.log(`CUSTOS on Spectrum — READ-ONLY (Phase 1). ${cloud ? "cloud/iMessage" : "local terminal"} mode.`);

  for await (const [space, message] of app.messages) {
    try {
      if (message?.type && message.type !== "text") continue;
      const reply = await answerReadOnly(extractText(message));
      if (space?.responding && typeof message?.reply === "function") {
        await space.responding(() => message.reply(reply));
      } else if (typeof message?.reply === "function") {
        await message.reply(reply);
      } else {
        await space.send(reply);
      }
    } catch (e) {
      console.error("spectrum message error:", e);
      try { await space.send("Something went wrong reading that — try again in a moment."); } catch {}
    }
  }
}

main().catch((e) => { console.error("spectrum fatal:", e); process.exit(1); });
