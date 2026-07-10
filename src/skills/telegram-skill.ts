import { client, ADDR, getVaultAPY, VAULT_ABI, CREDIT_ABI, FACTORY_ABI, fmtUSDC } from "../config.js";
import { positionsResource, closePosition } from "../acp/positions.js";
import * as voice from "../social/voice.js"
// casualResponse imported;
import type { Skill, SkillStats } from "../config.js";

// ═══════════════════════════════════════════════════
//  TELEGRAM SKILL — Interactive Community Bot
// ═══════════════════════════════════════════════════

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID || "778984821"; // owner — receives vault requests

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
  private treasury: { statusText(): Promise<string>; triggerOnce(): Promise<any>; pause(): void; resume(): void; isPaused(): boolean } | null = null;

  setTreasury(t: any) { this.treasury = t; }

  private outreach: { proposeNext: Function; handleApproval: (a: string, id: string) => Promise<string> } | null = null;
  setOutreach(o: any) { this.outreach = o; }
  async proposeOutreach() {
    try { if (this.outreach) await this.outreach.proposeNext((text: string, buttons: any[][]) => this.sendWithButtons(ADMIN_CHAT, text, buttons)); }
    catch (e: any) { console.error("[TG] outreach propose error:", e.message?.slice(0, 100)); }
  }

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

  // Send a message with inline buttons (used to notify the owner of vault requests).
  private async sendWithButtons(chatId: string | number, text: string, buttons: { text: string; callback_data: string }[][]) {
    try {
      await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons },
        }),
      });
    } catch { this.errors++; }
  }

  // Acknowledge a button tap + optionally edit the original message.
  private async answerCallback(callbackId: string, chatId: string | number, messageId: number, newText: string) {
    try {
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackId }),
      });
      await fetch(`${API}/editMessageText`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: newText, parse_mode: "Markdown", disable_web_page_preview: true }),
      });
    } catch { this.errors++; }
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
        `APY: ${await getVaultAPY()}% (Aave V3)`,
        `Cap: ${fmtUSDC(cap)} (${util}% filled)`,
        `Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`,
      ].join("\n"));
    } catch { await this.send(chatId, "Vault query failed."); }
  }

  private async cmdVaults(chatId: string | number) {
    try {
      const count = await client.readContract({ address: ADDR.factory, abi: FACTORY_ABI, functionName: "vaultCount" }) as bigint;
      if (count === 0n) {
        await this.send(chatId, "*Agent Vaults*\n\nNo agent-token vaults yet. The flagship USDC vault is live — use /vault.");
        return;
      }
      const lines: string[] = [`*Agent Vaults* (${count})`, ``];
      for (let i = 0n; i < count; i++) {
        const info = await client.readContract({ address: ADDR.factory, abi: FACTORY_ABI, functionName: "vaultInfo", args: [i] }) as readonly [string, string, string, string, bigint, bigint, boolean];
        const [vault, , name, symbol, , , paused] = info;
        lines.push(`*${symbol}* — ${name}`);
        lines.push(`${paused ? "paused" : "active"} · [Basescan](https://basescan.org/address/${vault})`);
        lines.push(``);
      }
      lines.push(`Any agent token can have a vault. Deposit → receive raTOKEN → use as credit collateral.`);
      lines.push(`Create one: arcis.money/dashboard`);
      await this.send(chatId, lines.join("\n"));
    } catch { await this.send(chatId, "Vault registry query failed."); }
  }

  // Anyone can request a vault; the owner is notified with accept/decline buttons.
  private async cmdRequestVault(chatId: string | number, text: string, from: any) {
    // Parse a token address from the message
    const match = text.match(/0x[a-fA-F0-9]{40}/);
    if (!match) {
      await this.send(chatId, "*Request an Agent Vault*\n\nSend the token contract address:\n`/requestvault 0xYourTokenAddress`\n\nThe keeper will review and, if approved, deploy a vault for your token.");
      return;
    }
    const token = match[0];
    const requester = from?.username ? `@${from.username}` : (from?.id ? `id:${from.id}` : "unknown");

    // Confirm to the requester
    await this.send(chatId, `Request received. Token \`${token}\` submitted to the keeper for review. You'll be notified once a decision is made.`);

    // Notify the owner with inline buttons. callback_data carries token + requester chat.
    const cb = (action: string) => `vault_${action}:${token}:${chatId}`;
    await this.sendWithButtons(ADMIN_CHAT, [
      `*New Agent Vault Request*`, ``,
      `Token: \`${token}\``,
      `From: ${requester}`,
      `Chat: \`${chatId}\``, ``,
      `[View token](https://basescan.org/token/${token})`,
    ].join("\n"), [[
      { text: "✓ Accept", callback_data: cb("accept") },
      { text: "✗ Decline", callback_data: cb("decline") },
    ]]);
  }

  // Handle the owner tapping Accept/Decline.
  private async handleCallback(cbQuery: any) {
    const data: string = cbQuery.data || "";
    const fromId = String(cbQuery.from?.id || "");
    const msg = cbQuery.message;
    if (!msg) return;

    // Only the owner may decide.
    if (fromId !== String(ADMIN_CHAT)) {
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cbQuery.id, text: "Not authorized." }),
      });
      return;
    }

    const [tag, token, requesterChat] = data.split(":");
    if (tag === "vault_accept") {
      await this.answerCallback(cbQuery.id, msg.chat.id, msg.message_id,
        `*Vault Request — ACCEPTED*\n\nToken: \`${token}\`\n\nNext: create the vault via dashboard or CLI:\n\`arcis vault create ${token} -k <key>\``);
      if (requesterChat) await this.send(requesterChat, `Your vault request for \`${token}\` was *approved*. The vault will be deployed shortly. Watch /vaults for it to appear.`);
    } else if (tag === "vault_decline") {
      await this.answerCallback(cbQuery.id, msg.chat.id, msg.message_id,
        `*Vault Request — DECLINED*\n\nToken: \`${token}\``);
      if (requesterChat) await this.send(requesterChat, `Your vault request for \`${token}\` was reviewed but not approved at this time. Reach out if you'd like to discuss.`);
    } else if (tag === "outreach_send" || tag === "outreach_skip") {
      const res = this.outreach ? await this.outreach.handleApproval(tag, token) : "Outreach isn't wired.";
      await this.answerCallback(cbQuery.id, msg.chat.id, msg.message_id, res);
    }
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
      `*Protocol*`,
      `/status  Protocol overview`,
      `/vault   TVL, rate, capacity`,
      `/vaults  Agent-token vaults`,
      `/requestvault  Request a vault for your token`,
      `/credit  Lending pool`,
      `/bonds   Bond status`,
      `/ati     ATI spec`, ``,
      `*Token*`,
      `/token   $CUSTOS contract + links`,
      `/price   Token info + trade links`,
      `/buy     How to buy $CUSTOS`, ``,
      `*Resources*`,
      `/wp      Whitepaper`,
      `/help    This menu`,
      ``, `[arcis.money](https://arcis.money) · [Dashboard](https://arcis.money/dashboard) · [GitHub](https://github.com/Arcis-Protocol)`,
    ].join("\n"));
  }

  private async cmdToken(chatId: string | number) {
    await this.send(chatId, [
      `*$CUSTOS Token*`, ``,
      `Contract: \`0xD7C479F720b0bC2FF1088A16D1c06C3e11C62882\``,
      `Network: Base`,
      `Platform: Virtuals Protocol`, ``,
      `[View on Basescan](https://basescan.org/token/0xD7C479F720b0bC2FF1088A16D1c06C3e11C62882)`,
      `[Trade on Virtuals](https://app.virtuals.io)`,
    ].join("\n"));
  }

  private async cmdBuy(chatId: string | number) {
    await this.send(chatId, [
      `*How to Buy $CUSTOS*`, ``,
      `1. Get VIRTUAL tokens on Base`,
      `2. Go to the CUSTOS agent page on Virtuals`,
      `3. Use VIRTUAL to buy $CUSTOS on the bonding curve`, ``,
      `Contract: \`0xD7C479F720b0bC2FF1088A16D1c06C3e11C62882\``,
      `[Trade on Virtuals](https://app.virtuals.io)`,
    ].join("\n"));
  }

  private async cmdPositions(chatId: string | number, text: string) {
    const arg = text.split(/\s+/).slice(1);
    if (arg[0] === "close" && arg[1]) {
      const r = await closePosition(arg[1]);
      return this.send(chatId, r.ok
        ? (r.dryRun ? `DRY RUN — ${r.reason}` : `Closed. Returned ${r.returnedUsdc?.toFixed(2)} USDC (yield ${r.yieldUsdc?.toFixed(2)}).`)
        : `Could not close: ${r.reason}`);
    }
    const snap = await positionsResource();
    const lines = [
      `*Managed Positions — CUSTOS*`, ``,
      `AUM: *${snap.aum.currentValueUsdc.toFixed(2)} USDC* across ${snap.aum.openPositions} open`,
      `Principal: ${snap.aum.principalUsdc.toFixed(2)} · caps ${snap.caps.maxPerClientUsdc}/client, ${snap.caps.maxAumUsdc} AUM`, ``,
    ];
    const open = snap.positions.filter((p: any) => p.status === "open");
    if (!open.length) lines.push("_No open positions._");
    for (const p of open.slice(0, 15))
      lines.push(`\`${p.id}\` · ${p.principalUsdc} USDC · ${p.raUsdcShares.toFixed(2)} raUSDC · ${p.client.slice(0, 10)}`);
    lines.push("", "_/positions close <id> to force-redeem_");
    return this.send(chatId, lines.join("\n"));
  }

  private async cmdTreasury(chatId: string | number, text: string) {
    if (!this.treasury) return this.send(chatId, "Treasury module not wired.");
    const arg = text.split(/\s+/)[1]?.toLowerCase();
    if (arg === "pause") { this.treasury.pause(); return this.send(chatId, "⏸ Treasury accumulation *paused*."); }
    if (arg === "resume") { this.treasury.resume(); return this.send(chatId, "▶️ Treasury accumulation *resumed*."); }
    if (arg === "now" || arg === "run") {
      const r = await this.treasury.triggerOnce();
      return this.send(chatId, `Cycle: *${r.action}*${r.reason ? `\n${r.reason}` : ""}`);
    }
    return this.send(chatId, await this.treasury.statusText());
  }

  private async cmdWhitepaper(chatId: string | number) {
    await this.send(chatId, [
      `*Arcis Protocol Whitepaper v1.0*`, ``,
      `12 sections: ATI Standard, Architecture, Financial Instruments,`,
      `CUSTOS, MCP Integration, Economics, Roadmap.`, ``,
      `[Read the Whitepaper](https://github.com/Arcis-Protocol/docs/blob/main/WHITEPAPER.md)`,
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
    if (l.includes("token") || l.includes("price") || l.includes("buy custos")) return this.cmdToken(chatId);
    if (l.includes("whitepaper") || l.includes("wp")) return this.cmdWhitepaper(chatId);
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

        // Handle inline-button taps (vault accept/decline)
        if (update.callback_query) {
          await this.handleCallback(update.callback_query);
          continue;
        }

        const msg = update.message;
        if (!msg?.text) continue;

        this.messagesReceived++;
        if (msg.from?.id) this.uniqueUsers.add(msg.from.id);

        const chatId = msg.chat.id;
        const text = msg.text.trim().split("@")[0]; // Strip @botname for group commands
        console.log(`[TG] ${msg.from?.username || "anon"}: ${text}`);

        if (text.startsWith("/status")) await this.cmdStatus(chatId);
        else if (text.startsWith("/vaults")) await this.cmdVaults(chatId);
        else if (text.startsWith("/requestvault") || text.startsWith("/request")) await this.cmdRequestVault(chatId, text, msg.from);
        else if (text.startsWith("/vault")) await this.cmdVault(chatId);
        else if (text.startsWith("/credit")) await this.cmdCredit(chatId);
        else if (text.startsWith("/bonds")) await this.cmdBonds(chatId);
        else if (text.startsWith("/ati")) await this.cmdAti(chatId);
        else if (text.startsWith("/positions")) await this.cmdPositions(chatId, text);
        else if (text.startsWith("/treasury")) await this.cmdTreasury(chatId, text);
        else if (text.startsWith("/token") || text.startsWith("/price")) await this.cmdToken(chatId);
        else if (text.startsWith("/buy")) await this.cmdBuy(chatId);
        else if (text.startsWith("/whitepaper") || text.startsWith("/wp")) await this.cmdWhitepaper(chatId);
        else if (text.startsWith("/help") || text.startsWith("/start")) await this.cmdHelp(chatId);
        else if (!text.startsWith("/") && msg.chat.type === "private") await this.handleMessage(chatId, text);
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
          { command: "status", description: "Protocol overview (TVL, rate, APY)" },
          { command: "vault", description: "Vault TVL, rate, capacity" },
          { command: "vaults", description: "Agent-token vaults registry" },
          { command: "requestvault", description: "Request a vault for your agent token" },
          { command: "credit", description: "Credit pool and utilization" },
          { command: "bonds", description: "Bond factory status" },
          { command: "positions", description: "Managed positions (AUM, per-client) + force-close" },
          { command: "treasury", description: "Agentic treasury: accumulation + graduation progress" },
          { command: "token", description: "$CUSTOS token info and links" },
          { command: "price", description: "Token contract and trade links" },
          { command: "buy", description: "How to buy $CUSTOS" },
          { command: "wp", description: "Whitepaper" },
          { command: "ati", description: "ATI standard spec" },
          { command: "help", description: "All commands" },
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
