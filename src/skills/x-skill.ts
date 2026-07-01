import { client, ADDR, getVaultAPY, VAULT_ABI, CREDIT_ABI, fmtUSDC, fmtDuration } from "../config.js";
import * as voice from "../social/voice.js";
import crypto from "crypto";
import type { Skill, SkillStats } from "../config.js";

// ═══════════════════════════════════════════════════
//  X SKILL — Scheduled Protocol Posts
// ═══════════════════════════════════════════════════

const API_KEY = process.env.X_API_KEY || "";
const API_SECRET = process.env.X_API_SECRET || "";
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || "";
const ACCESS_SECRET = process.env.X_ACCESS_SECRET || "";

export class XSkill implements Skill {
  name = "XSkill";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private postCount = 0;
  private startTime = Date.now();
  private postIndex = 0;

  private oauthSign(method: string, url: string): string {
    const params: Record<string, string> = {
      oauth_consumer_key: API_KEY,
      oauth_nonce: crypto.randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: ACCESS_TOKEN,
      oauth_version: "1.0",
    };
    const sorted = Object.keys(params).sort();
    const paramStr = sorted.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
    const baseStr = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
    const sigKey = `${encodeURIComponent(API_SECRET)}&${encodeURIComponent(ACCESS_SECRET)}`;
    params.oauth_signature = crypto.createHmac("sha1", sigKey).update(baseStr).digest("base64");
    return "OAuth " + Object.keys(params).sort().map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`).join(", ");
  }

  private async post(text: string): Promise<boolean> {
    if (!API_KEY || !ACCESS_TOKEN) {
      console.log(`[X] (dry) ${text.slice(0, 70)}...`);
      this.actions++;
      return false;
    }
    const url = "https://api.x.com/2/tweets";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: this.oauthSign("POST", url), "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        this.postCount++;
        this.actions++;
        console.log(`[X] Posted: ${text.slice(0, 50)}...`);
        return true;
      }
      this.errors++;
      return false;
    } catch { this.errors++; return false; }
  }

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();

    // Alternate: status → thesis → status → thesis
    if (this.postIndex % 2 === 0) {
      await this.postStatus();
    } else {
      await this.postThesis();
    }
    this.postIndex++;
  }

  private async postStatus() {
    try {
      const [totalAssets, rate, supply, pool, borrowed] = await Promise.all([
        client.readContract({ address: ADDR.vault // $CUSTOS token: 0xD7C479F720b0bC2FF1088A16D1c06C3e11C62882
, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault // $CUSTOS token: 0xD7C479F720b0bC2FF1088A16D1c06C3e11C62882
, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault // $CUSTOS token: 0xD7C479F720b0bC2FF1088A16D1c06C3e11C62882
, abi: VAULT_ABI, functionName: "totalSupply" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
      ]);
      const total = pool + borrowed;
      const util = total > 0n ? (Number(borrowed * 10000n / total) / 100).toFixed(1) : "0.0";
      const rateStr = supply > 0n ? (Number(rate) / 1e24).toFixed(6) : "1.000000";
      const apyStr = await getVaultAPY();
      await this.post(voice.xStatus(fmtUSDC(totalAssets), rateStr, `${util}%`, apyStr, this.postCount, fmtDuration(Date.now() - this.startTime)));
    } catch (e: any) { this.errors++; }
  }

  private async postThesis() {
    await this.post(voice.xThesis());
  }

  async postAction(action: string, detail: string) {
    await this.post(voice.actionReport(action, detail));
  }

  stats(): SkillStats {
    return {
      name: this.name, runs: this.runs, actions: this.actions,
      errors: this.errors, lastRun: this.lastRun,
      details: {
        postsPublished: String(this.postCount),
        mode: API_KEY ? "live" : "dry-run",
      },
    };
  }
}
