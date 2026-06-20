import {
  createPublicClient, createWalletClient, http, defineChain,
  formatUnits, type Address, type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ═══════════════════════════════════════════════════
//  CUSTOS — The Keeper of the Citadel
//  Autonomous DeFi agent for Arcis Protocol
// ═══════════════════════════════════════════════════

// ── Config ──
const PRIVATE_KEY = process.env.CUSTOS_PRIVATE_KEY as `0x${string}` | undefined;
const TELEGRAM_BOT = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const HARVEST_INTERVAL = 300_000;    // 5 minutes
const HEALTH_INTERVAL = 60_000;      // 1 minute
const BOND_INTERVAL = 600_000;       // 10 minutes
const STATUS_INTERVAL = 3_600_000;   // 1 hour

// ── Chain ──
const baseSepolia = defineChain({
  id: 84532, name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://base-sepolia.blockscout.com" } },
});

// ── Addresses ──
const ADDR = {
  vault: "0xa8eF658E125C7f6D7aFa9B6b8035b66b32CBE98d" as Address,
  credit: "0x019540E33a0292a9DDE36bD9Ef11774d5A1Ce6FC" as Address,
  router: "0x0281e7D37683c585325004F84e0b94170c78d5B4" as Address,
  usdc: "0x29440A12f15fe6bDf5F624f4eeEB298CCb782f05" as Address,
};

// ── ABIs ──
const VAULT_ABI = [
  { name: "totalAssets", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "exchangeRate", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "reserveBalance", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "deployedBalance", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "paused", type: "function", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "harvest", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { name: "rebalance", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" },
] as const;

const CREDIT_ABI = [
  { name: "lendingPool", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalBorrowed", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "loanCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalOwed", type: "function", inputs: [{ name: "loanId", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "liquidate", type: "function", inputs: [{ name: "loanId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

// ── Client ──
const client = createPublicClient({ chain: baseSepolia, transport: http() });
const fmtUSDC = (v: bigint) => "$" + (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── State ──
let lastTVL = 0n;
let totalHarvested = 0n;
let totalLiquidations = 0;
let totalActions = 0;
let startTime = Date.now();

// ═══════════════════════════════════════════════════
//  ALERTS
// ═══════════════════════════════════════════════════

async function alert(msg: string, level: "INFO" | "WARN" | "CRIT" = "INFO") {
  const icon = level === "CRIT" ? "\u{1F534}" : level === "WARN" ? "\u{1F7E1}" : "\u{1F7E2}";
  const text = `${icon} *CUSTOS*\n\n${msg}\n\n_${new Date().toISOString()}_`;
  console.log(`[CUSTOS ${level}] ${msg}`);

  if (TELEGRAM_BOT && TELEGRAM_CHAT) {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT, text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      });
    } catch (e: any) {
      console.error("  Telegram failed:", e.message);
    }
  }
}

// ═══════════════════════════════════════════════════
//  VAULT KEEPER
// ═══════════════════════════════════════════════════

async function vaultKeeper() {
  try {
    const [totalAssets, reserve, deployed, paused] = await Promise.all([
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }),
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "reserveBalance" }),
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "deployedBalance" }),
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "paused" }),
    ]);

    // Alert: vault paused
    if (paused) {
      await alert("Vault is *PAUSED*. All operations suspended.", "CRIT");
      return;
    }

    // Alert: TVL drop > 15%
    if (lastTVL > 0n && totalAssets < lastTVL * 85n / 100n) {
      const drop = Number((lastTVL - totalAssets) * 10000n / lastTVL) / 100;
      await alert(`TVL dropped ${drop.toFixed(1)}%\nWas: ${fmtUSDC(lastTVL)}\nNow: ${fmtUSDC(totalAssets)}`, "CRIT");
    }

    lastTVL = totalAssets;

    // Action: harvest yield from strategies
    if (deployed > 0n && PRIVATE_KEY) {
      try {
        const account = privateKeyToAccount(PRIVATE_KEY);
        const wallet = createWalletClient({ chain: baseSepolia, transport: http(), account });
        const hash = await wallet.writeContract({
          address: ADDR.vault, abi: VAULT_ABI, functionName: "harvest",
          chain: baseSepolia,
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          totalActions++;
          console.log(`[CUSTOS] Harvested. TX: ${hash}`);
        }
      } catch (e: any) {
        // Harvest may revert if no yield — that's fine
        if (!e.message?.includes("revert")) {
          console.error("[CUSTOS] Harvest error:", e.message?.slice(0, 80));
        }
      }
    }

    console.log(`[VAULT] TVL: ${fmtUSDC(totalAssets)} | Reserve: ${fmtUSDC(reserve)} | Deployed: ${fmtUSDC(deployed)}`);
  } catch (e: any) {
    console.error("[VAULT] Keeper error:", e.message?.slice(0, 100));
  }
}

// ═══════════════════════════════════════════════════
//  CREDIT KEEPER
// ═══════════════════════════════════════════════════

async function creditKeeper() {
  try {
    const [pool, borrowed, loanCount] = await Promise.all([
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }),
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }),
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "loanCount" }),
    ]);

    const total = pool + borrowed;
    const utilization = total > 0n ? Number(borrowed * 10000n / total) / 100 : 0;

    // Alert: high utilization
    if (utilization > 85) {
      await alert(`Credit utilization at ${utilization.toFixed(1)}%\nPool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)}`, "WARN");
    }

    // Check each loan for liquidation
    const count = Number(loanCount);
    for (let i = 1; i <= count; i++) {
      try {
        const owed = await client.readContract({
          address: ADDR.credit, abi: CREDIT_ABI,
          functionName: "totalOwed", args: [BigInt(i)],
        });

        // If loan exists and has debt, check health
        // A loan is unhealthy when collateral value < owed * collateral ratio
        // For now, flag loans with growing debt
        if (owed > 0n) {
          console.log(`[CREDIT] Loan #${i}: owed ${fmtUSDC(owed)}`);
        }
      } catch {
        // Loan doesn't exist or is already repaid
      }
    }

    console.log(`[CREDIT] Pool: ${fmtUSDC(pool)} | Borrowed: ${fmtUSDC(borrowed)} | Util: ${utilization.toFixed(1)}% | Loans: ${count}`);
  } catch (e: any) {
    console.error("[CREDIT] Keeper error:", e.message?.slice(0, 100));
  }
}

// ═══════════════════════════════════════════════════
//  BOND KEEPER
// ═══════════════════════════════════════════════════

async function bondKeeper() {
  // Bond keeper will service debt and deposit principal
  // when RevenueBondFactory is deployed to testnet
  console.log("[BONDS] Keeper ready. Awaiting bond deployment.");
}

// ═══════════════════════════════════════════════════
//  STATUS REPORT
// ═══════════════════════════════════════════════════

async function statusReport() {
  try {
    const [totalAssets, rate, pool, borrowed] = await Promise.all([
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }),
      client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "exchangeRate" }),
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "lendingPool" }),
      client.readContract({ address: ADDR.credit, abi: CREDIT_ABI, functionName: "totalBorrowed" }),
    ]);

    const total = pool + borrowed;
    const utilization = total > 0n ? Number(borrowed * 10000n / total) / 100 : 0;
    const uptime = Math.floor((Date.now() - startTime) / 60_000);
    const rateStr = (Number(rate) / 1e18).toFixed(6);

    const report = [
      `*Custos Status Report*`,
      ``,
      `Vault TVL: ${fmtUSDC(totalAssets)}`,
      `Exchange Rate: ${rateStr} USDC/raUSDC`,
      `Credit Utilization: ${utilization.toFixed(1)}%`,
      ``,
      `Actions: ${totalActions}`,
      `Uptime: ${uptime} min`,
    ].join("\n");

    await alert(report, "INFO");
  } catch (e: any) {
    console.error("[STATUS] Report error:", e.message?.slice(0, 100));
  }
}

// ═══════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════

async function main() {
  console.log("");
  console.log("  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("  \u2551   C U S T O S                        \u2551");
  console.log("  \u2551   The Keeper of the Citadel           \u2551");
  console.log("  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log("");
  console.log(`  Vault:     ${ADDR.vault}`);
  console.log(`  Credit:    ${ADDR.credit}`);
  console.log(`  Signer:    ${PRIVATE_KEY ? "configured" : "read-only mode"}`);
  console.log(`  Telegram:  ${TELEGRAM_BOT ? "configured" : "stdout only"}`);
  console.log("");
  console.log(`  Intervals:`);
  console.log(`    Harvest:  ${HARVEST_INTERVAL / 1000}s`);
  console.log(`    Health:   ${HEALTH_INTERVAL / 1000}s`);
  console.log(`    Bonds:    ${BOND_INTERVAL / 1000}s`);
  console.log(`    Status:   ${STATUS_INTERVAL / 1000}s`);
  console.log("");

  // Initial run
  await vaultKeeper();
  await creditKeeper();
  await bondKeeper();
  await statusReport();

  // Start keeper loops
  setInterval(vaultKeeper, HARVEST_INTERVAL);
  setInterval(creditKeeper, HEALTH_INTERVAL);
  setInterval(bondKeeper, BOND_INTERVAL);
  setInterval(statusReport, STATUS_INTERVAL);

  console.log("  Custos is watching. Press Ctrl+C to stop.\n");
}

main().catch(console.error);
