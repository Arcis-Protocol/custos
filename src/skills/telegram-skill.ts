import { client, ADDR, VAULT_ABI, CREDIT_ABI, fmtUSDC } from "../config.js";
import * as voice from "../social/voice.js";
import type { Skill, SkillStats } from "../config.js";

// ═══════════════════════════════════════════════════
//  TELEGRAM SKILL — Interactive Community Bot
// ═══════════════════════════════════════════════════

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export class TelegramSkill implements Skill {
  name = "TelegramSkill";

  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private messagesReceived = 0;
  private responsesGiven = 0;
  private uniqueUsers = new Set<number>();
  private lastUpdateId = 0;
  private running = false;

  private async send(chatId: string | number, text: string) {
    try {
      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
      });
      this.responsesGiven++;
      this.actions++;
    } catch (e: any) {
      this.errors++;
    }
  }

  // ── Command Handlers ──

  private async cmdStatus(chatId: string | number) {
    try {
      const [totalAssets, rate, supply, reserve, deployed, pool, borrowed, paused] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalSupply" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "deployedBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "paused" }) as Promise<boolean>,
      ]);

      const total = pool + borrowed;
      const util = total > 0n ? (Number(borrowed * 10000n / total) / 100).toFixed(1) : "0.0";
      const rateStr = supply > 0n ? (Number(rate) / 1e24).toFixed(6) : "1.000000";

      await this.send(chatId, [
        `*Protocol Status*`,
        ``, `Vault: ${paused ? "⏸ PAUSED" : "● Active"}`,
        `TVL: ${fmtUSDC(totalAssets)}`, `Rate: ${rateStr} USDC/raUSDC`,
        `Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`,
        ``, `Credit util: ${util}%`,
        `Pool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)}`,
        ``, `_${voice.signOff()}_`,
      ].join("\n"));
    } catch { await this.send(chatId, "Query failed. Retrying on next cycle."); }
  }

  private async cmdVault(chatId: string | number) {
    try {
      const [totalAssets, rate, cap, remaining, reserve, deployed] = await Promise.all([
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "depositCap" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "remainingCapacity" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }) as Promise<bigint>,
        client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "deployedBalance" }) as Promise<bigint>,
      ]);
      const util = cap > 0n ? (Number(totalAssets * 10000n / cap) / 100).toFixed(1) : "0";
      await this.send(chatId, [
        `*Vault*`, ``, `TVL: ${fmtUSDC(totalAssets)}`,
        `Rate: ${(Number(rate) / 1e24).toFixed(6)} USDC/share`,
        `Cap: ${fmtUSDC(cap)} (${util}% filled)`,
        `Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`,
      ].join("\n"));
    } catch { await this.send(chatId, "Vault query failed."); }
  }

  private async cmdCredit(chatId: string | number) {
    try {
      const [pool, borrowed, loanCount] = await Promise.all([
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
        client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "loanCount" }) as Promise<bigint>,
      ]);
      const total = pool + borrowed;
      const util = total > 0n ? (Number(borrowed * 10000n / total) / 100).toFixed(1) : "0.0";
      await this.send(chatId, [
        `*Credit*`, ``, `Pool: ${fmtUSDC(pool)}`, `Borrowed: ${fmtUSDC(borrowed)}`,
        `Utilization: ${util}%`, `Active Loans: ${loanCount}`,
      ].join("\n"));
    } catch { await this.send(chatId, "Credit query failed."); }
  }

  private async cmdBonds(chatId: string | number) {
    try {
      const bondCount = await client.readContract({ address: ADDR.bondFactory!, abi: [{ name: "bondCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }] as const, functionName: "bondCount" }) as bigint;
      await this.send(chatId, [
        "*Revenue Bonds*", "",
        "Factory: " + ADDR.bondFactory,
        "Active Bonds: " + bondCount.toString(), "",
        "Agents issue bonds. Humans buy yield.",
        "Smart contracts service debt.",
      ].join("\n"));
    } catch {
      await this.send(chatId, "*Revenue Bonds*\n\nFactory deployed. No active bonds yet.\n\nAgents issue bonds. Humans buy yield.\nSmart contracts service debt.");
    }
  }

  private async cmdAti(chatId: string | number) {
    await this.send(chatId, [
      `*Agent Treasury Interface v1.1*`, ``,
      "```", `deposit(uint256 amount)  → shares`, `withdraw(uint256 shares) → amount`,
      `balance(address agent)   → value`, `asset()                  → token`,
      `totalAssets()            → tvl`, `maxDeposit(address)      → max`, "```",
      ``, `Three functions. Any agent framework.`,
    ].join("\n"));
  }

  private async cmdHelp(chatId: string | number) {
    await this.send(chatId, [
      `*CUSTOS — The Keeper of the Citadel*`, ``,
      `/status  Protocol overview`, `/vault   TVL, rate, capacity`,
      `/credit  Lending pool`, `/bonds   Bond status`, `/ati     ATI spec`, `/help    Commands`,
      ``, `[arcis.money](https://arcis.money) · [Dashboard](https://arcis.money/dashboard) · [GitHub](https://github.com/Arcis-Protocol)`,
    ].join("\n"));
  }

  // ── Natural Language ──

  private async handleMessage(chatId: string | number, text: string) {
    const l = text.toLowerCase();
    if (l.includes("tvl") || l.includes("how much")) return this.cmdVault(chatId);
    if (l.includes("rate") || l.includes("exchange")) return this.cmdVault(chatId);
    if (l.includes("loan") || l.includes("borrow") || l.includes("credit")) return this.cmdCredit(chatId);
    if (l.includes("bond") || l.includes("yield") || l.includes("coupon")) return this.cmdBonds(chatId);
    if (l.includes("ati") || l.includes("interface") || l.includes("standard")) return this.cmdAti(chatId);
    if (l.includes("what is arcis") || l.includes("what does arcis"))
      return this.send(chatId, "Arcis is financial infrastructure for autonomous AI agents. Yield-bearing vaults, identity-aware credit, revenue bonds. The citadel of agent capital.\n\narcis.money");
    if (l.includes("custos") || l.includes("keeper") || l.includes("who are you"))
      return this.send(chatId, "I am CUSTOS. The autonomous keeper of the citadel. I harvest yield, monitor loans, service bonds, and report protocol health.\n\n_Custos nunquam dormit._");
    if (l.includes("gm") || l.includes("hello") || l.includes("hi") || l.includes("hey"))
      return this.send(chatId, voice.greeting());
    return this.send(chatId, voice.unknownQuery() + "\n\nType /help for commands.");
  }

  // ── Poll ──

  async run(): Promise<void> {
    if (!BOT_TOKEN) return;
    this.runs++;
    this.lastRun = Date.now();

    try {
      const res = await fetch(`${API}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=1&limit=10`);
      const data = await res.json() as any;
      if (!data.ok || !data.result) return;

      for (const update of data.result) {
        this.lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg?.text) continue;

        this.messagesReceived++;
        if (msg.from?.id) this.uniqueUsers.add(msg.from.id);

        const chatId = msg.chat.id;
        const text = msg.text.trim();
        console.log(`[TG] ${msg.from?.username || "anon"}: ${text}`);

        if (text.startsWith("/status")) await this.cmdStatus(chatId);
        else if (text.startsWith("/vault")) await this.cmdVault(chatId);
        else if (text.startsWith("/credit")) await this.cmdCredit(chatId);
        else if (text.startsWith("/bonds")) await this.cmdBonds(chatId);
        else if (text.startsWith("/ati")) await this.cmdAti(chatId);
        else if (text.startsWith("/help") || text.startsWith("/start")) await this.cmdHelp(chatId);
        else await this.handleMessage(chatId, text);
      }
    } catch (e: any) {
      if (!e.message?.includes("abort")) this.errors++;
    }
  }

  async initialize() {
    if (!BOT_TOKEN) {
      console.log("[TG] No TELEGRAM_BOT_TOKEN — skill disabled.");
      return;
    }
    await fetch(`${API}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "status", description: "Full protocol overview" },
          { command: "vault", description: "Vault TVL, rate, capacity" },
          { command: "credit", description: "Lending pool, utilization" },
          { command: "bonds", description: "Revenue bond status" },
          { command: "ati", description: "Agent Treasury Interface spec" },
          { command: "help", description: "Command list" },
        ],
      }),
    });
    console.log("[TG] Bot commands registered. Polling active.");
  }

  stats(): SkillStats {
    return {
      name: this.name, runs: this.runs, actions: this.actions,
      errors: this.errors, lastRun: this.lastRun,
      details: {
        messagesReceived: String(this.messagesReceived),
        responsesGiven: String(this.responsesGiven),
        uniqueUsers: String(this.uniqueUsers.size),
      },
    };
  }
}
