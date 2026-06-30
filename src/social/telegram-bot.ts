import { client, ADDR, VAULT_ABI, CREDIT_ABI, fmtUSDC } from "../config.js";
import * as voice from "./voice.js";

// ═══════════════════════════════════════════════════
//  CUSTOS TELEGRAM BOT — Interactive Community Agent
// ═══════════════════════════════════════════════════

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

let lastUpdateId = 0;
let running = false;

// ── Send Message ──
async function send(chatId: string | number, text: string, parseMode = "Markdown") {
  try {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
  } catch (e: any) {
    console.error("[TG-BOT] Send failed:", e.message);
  }
}

// ── Command Handlers ──

async function cmdStatus(chatId: string | number) {
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
    const rateStr = supply > 0n ? (Number(rate) / 1e18).toFixed(6) : "1.000000";

    const msg = [
      `*Protocol Status*`,
      ``,
      `Vault: ${paused ? "⏸ PAUSED" : "● Active"}`,
      `TVL: ${fmtUSDC(totalAssets)}`,
      `Rate: ${rateStr} USDC/raUSDC`,
      `Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`,
      ``,
      `Credit util: ${util}%`,
      `Pool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)}`,
      ``,
      `_${voice.signOff()}_`,
    ].join("\n");

    await send(chatId, msg);
  } catch (e: any) {
    await send(chatId, `Failed to fetch status: ${e.message?.slice(0, 60)}`);
  }
}

async function cmdVault(chatId: string | number) {
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
    const rateStr = (Number(rate) / 1e18).toFixed(6);

    const msg = [
      `*Vault*`,
      ``,
      `TVL: ${fmtUSDC(totalAssets)}`,
      `Exchange Rate: ${rateStr}`,
      `Cap: ${fmtUSDC(cap)} (${util}% filled)`,
      `Remaining: ${fmtUSDC(remaining)}`,
      ``,
      `Reserve: ${fmtUSDC(reserve)}`,
      `Deployed: ${fmtUSDC(deployed)}`,
    ].join("\n");

    await send(chatId, msg);
  } catch (e: any) {
    await send(chatId, `Query failed: ${e.message?.slice(0, 60)}`);
  }
}

async function cmdCredit(chatId: string | number) {
  try {
    const [pool, borrowed, loanCount] = await Promise.all([
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }) as Promise<bigint>,
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }) as Promise<bigint>,
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "loanCount" }) as Promise<bigint>,
    ]);

    const total = pool + borrowed;
    const util = total > 0n ? (Number(borrowed * 10000n / total) / 100).toFixed(1) : "0.0";

    const msg = [
      `*Credit*`,
      ``,
      `Pool: ${fmtUSDC(pool)}`,
      `Borrowed: ${fmtUSDC(borrowed)}`,
      `Utilization: ${util}%`,
      `Active Loans: ${loanCount}`,
    ].join("\n");

    await send(chatId, msg);
  } catch (e: any) {
    await send(chatId, `Query failed: ${e.message?.slice(0, 60)}`);
  }
}

async function cmdBonds(chatId: string | number) {
  const msg = [
    `*Revenue Bonds*`,
    ``,
    `Factory deployed. No active bonds yet.`,
    ``,
    `Agents issue bonds. Humans buy yield.`,
    `Smart contracts service debt.`,
  ].join("\n");
  await send(chatId, msg);
}

async function cmdHelp(chatId: string | number) {
  const msg = [
    `*CUSTOS — The Keeper of the Citadel*`,
    ``,
    `/status  — Full protocol overview`,
    `/vault   — Vault TVL, rate, capacity`,
    `/credit  — Lending pool, utilization`,
    `/bonds   — Revenue bond status`,
    `/ati     — Agent Treasury Interface spec`,
    `/help    — This message`,
    ``,
    `[arcis.money](https://arcis.money) · [Dashboard](https://arcis.money/dashboard) · [GitHub](https://github.com/Arcis-Protocol)`,
  ].join("\n");
  await send(chatId, msg);
}

async function cmdAti(chatId: string | number) {
  const msg = [
    `*Agent Treasury Interface v1.1*`,
    ``,
    "```",
    `deposit(uint256 amount)  → uint256 shares`,
    `withdraw(uint256 shares) → uint256 amount`,
    `balance(address agent)   → uint256 value`,
    `asset()                  → address token`,
    `totalAssets()            → uint256 tvl`,
    `maxDeposit(address)      → uint256 max`,
    "```",
    ``,
    `Three functions. Any agent framework.`,
    `The citadel has no gatekeepers.`,
  ].join("\n");
  await send(chatId, msg);
}

// ── Natural Language Responses ──

async function handleMessage(chatId: string | number, text: string) {
  const lower = text.toLowerCase().trim();

  // Protocol questions
  if (lower.includes("tvl") || lower.includes("how much")) {
    return cmdVault(chatId);
  }
  if (lower.includes("rate") || lower.includes("exchange")) {
    return cmdVault(chatId);
  }
  if (lower.includes("loan") || lower.includes("borrow") || lower.includes("credit")) {
    return cmdCredit(chatId);
  }
  if (lower.includes("bond") || lower.includes("yield") || lower.includes("coupon")) {
    return cmdBonds(chatId);
  }
  if (lower.includes("ati") || lower.includes("interface") || lower.includes("standard")) {
    return cmdAti(chatId);
  }
  if (lower.includes("what is arcis") || lower.includes("what does arcis")) {
    return send(chatId, "Arcis is financial infrastructure for autonomous AI agents. Yield-bearing vaults, identity-aware credit, revenue bonds. The citadel of agent capital.\n\narcis.money");
  }
  if (lower.includes("custos") || lower.includes("keeper") || lower.includes("who are you")) {
    return send(chatId, "I am CUSTOS. The autonomous keeper of the citadel. I harvest yield, monitor loans, service bonds, and report protocol health.\n\n_Custos nunquam dormit._");
  }
  if (lower.includes("gm") || lower.includes("hello") || lower.includes("hi")) {
    return send(chatId, voice.greeting());
  }

  // Default
  return send(chatId, voice.unknownQuery() + "\n\nType /help for commands.");
}

// ── Poll Loop ──

async function pollUpdates() {
  try {
    const res = await fetch(`${API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    const data = await res.json() as any;

    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      lastUpdateId = update.update_id;
      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = msg.chat.id;
      const text = msg.text.trim();

      console.log(`[TG-BOT] ${msg.from?.username || "anon"}: ${text}`);

      // Route commands
      if (text.startsWith("/status")) await cmdStatus(chatId);
      else if (text.startsWith("/vault")) await cmdVault(chatId);
      else if (text.startsWith("/credit")) await cmdCredit(chatId);
      else if (text.startsWith("/bonds")) await cmdBonds(chatId);
      else if (text.startsWith("/ati")) await cmdAti(chatId);
      else if (text.startsWith("/help") || text.startsWith("/start")) await cmdHelp(chatId);
      else await handleMessage(chatId, text);
    }
  } catch (e: any) {
    // Network errors during long poll — retry silently
    if (!e.message?.includes("abort")) {
      console.error("[TG-BOT] Poll error:", e.message?.slice(0, 60));
    }
  }
}

// ── Start ──

export async function startTelegramBot() {
  if (!BOT_TOKEN) {
    console.log("[TG-BOT] No TELEGRAM_BOT_TOKEN — bot disabled.");
    return;
  }

  running = true;
  console.log("[TG-BOT] Interactive bot started. Listening for messages...");

  // Set bot commands
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

  // Poll loop
  while (running) {
    await pollUpdates();
  }
}

export function stopTelegramBot() {
  running = false;
}
