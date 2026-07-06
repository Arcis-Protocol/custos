// @ts-nocheck — Spectrum transport runtime. Types resolve after `npm install spectrum-ts`.
// ═══════════════════════════════════════════════════════════════════════════
//  spectrum-runtime.ts — CUSTOS on Spectrum (iMessage / terminal)
//
//  startSpectrum() is called two ways:
//   • standalone local test:  `npm run spectrum`  (terminal provider, zero creds)
//   • in-process on Railway:  the keeper boots it when SPECTRUM_IMESSAGE=true
//     and PROJECT_ID + PROJECT_SECRET are set (managed iMessage line).
//
//  All behavior + the money guardrail live in ./spectrum-brain.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { Spectrum } from "spectrum-ts";
import { terminal, imessage } from "spectrum-ts/providers";
import { answerReadOnly } from "./spectrum-brain.js";

function extractText(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c[0]?.text) return c[0].text;      // legacy Content[]
  if (c && typeof c === "object" && typeof c.text === "string") return c.text;
  if (typeof message?.text === "string") return message.text;
  return "";
}

export async function startSpectrum() {
  const projectId = process.env.PROJECT_ID;
  const projectSecret = process.env.PROJECT_SECRET;
  const cloud = Boolean(projectId && projectSecret);

  // Railway/cloud iMessage: imessage only (no TTY). Local: terminal.
  const providers = [];
  if (cloud && process.env.SPECTRUM_IMESSAGE === "true") providers.push(imessage.config());
  const wantTerminal = !cloud || process.env.SPECTRUM_TERMINAL === "true" || providers.length === 0;
  if (wantTerminal) providers.push(terminal.config());

  const app = await Spectrum(cloud ? { projectId, projectSecret, providers } : { providers });

  const mode = providers.some((p) => p === imessage || true) && cloud && process.env.SPECTRUM_IMESSAGE === "true"
    ? "cloud/iMessage" : "local terminal";
  console.log(`[spectrum] CUSTOS live — ${mode} mode.`);

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
      console.error("[spectrum] message error:", e);
      try { await space.send("Something went wrong reading that — try again in a moment."); } catch {}
    }
  }
}
