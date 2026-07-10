// ═══════════════════════════════════════════════════════════════════════════
//  campaign/scheduler.ts — runs the whole loop on a schedule, hands-off.
//
//  Every CAMPAIGN_INTERVAL_HOURS it deep-scans for prospects, then runs outreach
//  (which DMs you approvals in Telegram). Long-lived process — deploy it as its
//  own service, or use your host's native cron pointed at `npm run campaign`.
//
//  Run:  npm run campaign:auto
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from "child_process";
import { promisify } from "util";
const pexec = promisify(execFile);

const HOURS = Number(process.env.CAMPAIGN_INTERVAL_HOURS || 24);

async function run(step: string) {
  try {
    const { stdout } = await pexec("npm", ["run", step], { env: process.env, maxBuffer: 1e8 });
    process.stdout.write(stdout.split("\n").slice(-6).join("\n") + "\n");
  } catch (e: any) { console.error(`[campaign] ${step} failed:`, (e.message || "").slice(0, 200)); }
}

async function cycle() {
  console.log(`\n[campaign] ${new Date().toISOString()} — deep scan + outreach`);
  await run("prospect");
  await run("outreach");
  console.log(`[campaign] cycle done — next in ${HOURS}h`);
}

(async () => {
  console.log(`[campaign] scheduler online — every ${HOURS}h`);
  await cycle();
  setInterval(cycle, HOURS * 3600 * 1000);
})();
