// @ts-nocheck — standalone Spectrum runner for `npm run spectrum` (local iMessage/terminal test).
// The reusable logic lives in ./channels/spectrum-runtime.ts (also booted in-process by the keeper).
import { startSpectrum } from "./channels/spectrum-runtime.js";
startSpectrum().catch((e) => { console.error("spectrum fatal:", e); process.exit(1); });
