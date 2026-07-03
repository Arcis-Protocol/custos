import { client, ADDR, VAULT_ABI, CREDIT_ABI, FACTORY_ABI, fmtUSDC, fmtDuration } from "../config.js";
import * as voice from "./voice.js";
import crypto from "crypto";

// ═══════════════════════════════════════════════════
//  CUSTOS X POSTER — Scheduled Protocol Updates
// ═══════════════════════════════════════════════════

// X API v2 credentials (set via environment)
const API_KEY = process.env.X_API_KEY || "";
const API_SECRET = process.env.X_API_SECRET || "";
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";
const POST_INTERVAL = parseInt(process.env.X_POST_INTERVAL || "14400000"); // 4 hours default

let postCount = 0;
let lastPostTime = 0;
let startTime = Date.now();

// ── OAuth 1.0a Signature ──

function oauthSign(method: string, url: string, params: Record<string, string>): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: "1.0",
    ...params,
  };

  const sortedKeys = Object.keys(oauthParams).sort();
  const paramStr = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`).join("&");
  const baseStr = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  const signingKey = `${encodeURIComponent(API_SECRET)}&${encodeURIComponent(ACCESS_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseStr).digest("base64");

  oauthParams.oauth_signature = signature;
  const authHeader = "OAuth " + Object.keys(oauthParams)
    .filter(k => k.startsWith("oauth_"))
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(", ");

  return authHeader;
}

// ── Post to X ──

async function post(text: string): Promise<boolean> {
  if (!API_KEY || !ACCESS_TOKEN) {
    console.log(`[X] (dry run) ${text.slice(0, 60)}...`);
    return false;
  }

  const url = "https://api.x.com/2/tweets";
  const authHeader = oauthSign("POST", url, {});

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      postCount++;
      lastPostTime = Date.now();
      console.log(`[X] Posted: ${text.slice(0, 50)}... (id: ${data.data?.id})`);
      return true;
    } else {
      const err = await res.text();
      console.error(`[X] Post failed (${res.status}): ${err.slice(0, 100)}`);
      return false;
    }
  } catch (e: any) {
    console.error(`[X] Error: ${e.message}`);
    return false;
  }
}

// ── Post Types ──

async function postStatus() {
  try {
    const [totalAssets, rate, supply, pool, borrowed] = await Promise.all([
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalSupply" }) as Promise<bigint>,
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
    ]);

    const total = pool + borrowed;
    const util = total > 0n ? (Number(borrowed * 10000n / total) / 100).toFixed(1) : "0.0";
    const rateStr = supply > 0n ? (Number(rate) / 1e18).toFixed(6) : "1.000000";
    const uptime = fmtDuration(Date.now() - startTime);

    const text = voice.xStatus(fmtUSDC(totalAssets), rateStr, `${util}%`, postCount, uptime);
    await post(text);
  } catch (e: any) {
    console.error("[X] Status fetch failed:", e.message?.slice(0, 60));
  }
}

async function postThesis() {
  const text = voice.xThesis();
  await post(text);
}

async function postVaults() {
  try {
    const count = await client.readContract({ address: ADDR.factory, abi: FACTORY_ABI, functionName: "vaultCount" }) as bigint;
    if (count === 0n) { await postStatus(); return; } // nothing to show yet
    const first = await client.readContract({ address: ADDR.factory, abi: FACTORY_ABI, functionName: "vaultInfo", args: [0n] }) as readonly [string, string, string, string, bigint, bigint, boolean];
    const symbol = first[3];
    const text = voice.xVaults(Number(count), symbol);
    await post(text);
  } catch (e: any) {
    console.error("[X] Vaults fetch failed:", e.message?.slice(0, 60));
    await postStatus();
  }
}

// ── Scheduler ──

let postIndex = 0;

async function scheduledPost() {
  // Rotate: status, thesis, status, vaults, ...
  const mod = postIndex % 4;
  if (mod === 0 || mod === 2) await postStatus();
  else if (mod === 1) await postThesis();
  else await postVaults();
  postIndex++;
}

// ── Start ──

export async function startXPoster() {
  if (!API_KEY || !ACCESS_TOKEN) {
    console.log("[X] No X_API_KEY — poster running in dry-run mode (logs only).");
  } else {
    console.log(`[X] Poster started. Posting every ${POST_INTERVAL / 60_000} min.`);
  }

  // First post after 5 minutes (don't spam on restart)
  setTimeout(async () => {
    await scheduledPost();
    // Then on interval
    setInterval(scheduledPost, POST_INTERVAL);
  }, 300_000);
}

// ── Manual Post (for keeper events) ──

export async function postKeeperAction(action: string, detail: string) {
  const text = voice.actionReport(action, detail);
  await post(text);
}

export function getXStats() {
  return { postCount, lastPostTime };
}
