import {
  createPublicClient, createWalletClient, http, defineChain,
  type Address, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Chain ──
export const baseSepolia = defineChain({
  id: 8453, name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.base.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://basescan.org" } },
});

// ── Addresses ──
export const ADDR = {
  vault: "0x00325d9da832b38179ed2f0dabd4062d93e325a7" as Address,
  credit: "0xdf31800e620f728297340d66acf5a306f07ce7a1" as Address,
  router: "0xd0c64f997ca9aa427f8834578bd7f0313f868e83" as Address,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  allocator: "0x7Fd5d7b49694858FCf143E0039e83cDB0196DD7A" as Address,
  bondFactory: "0xeb65d8bb08e0ea4a6bb9162d53d1b444f99681ba" as Address,
  identity: "0xaa4da295dd368c0f10128654af76e3f002e20e71" as Address,
};

export const EXPLORER = "https://basescan.org";

// ── ABIs ──
export const VAULT_ABI = [
  { name: "totalAssets", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalSupply", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "exchangeRate", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "depositCap", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "reserveBalance", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "deployedBalance", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "paused", type: "function", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "feeBps", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "harvest", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { name: "rebalance", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" },
] as const;

export const CREDIT_ABI = [
  { name: "lendingPool", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalBorrowed", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "baseRateBps", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "loanCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalOwed", type: "function", inputs: [{ name: "loanId", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "paused", type: "function", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "liquidate", type: "function", inputs: [{ name: "loanId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const BOND_ABI = [
  { name: "bondCount", type: "function", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "escrowBalances", type: "function", inputs: [{ name: "bondId", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "totalRevenueAccumulated", type: "function", inputs: [{ name: "bondId", type: "uint256" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "paused", type: "function", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { name: "serviceDebt", type: "function", inputs: [{ name: "bondId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { name: "depositPrincipal", type: "function", inputs: [{ name: "bondId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

// ── Client ──
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
export const client: PublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
  batch: { multicall: true },
});

const PRIVATE_KEY = process.env.CUSTOS_PRIVATE_KEY as `0x${string}` | undefined;

export function getWallet(): WalletClient | null {
  if (!PRIVATE_KEY) return null;
  const account = privateKeyToAccount(PRIVATE_KEY);
  return createWalletClient({ chain: baseSepolia, transport: http(), account });
}

export function hasWriteAccess(): boolean {
  return !!PRIVATE_KEY;
}

// ── Helpers ──
export const fmtUSDC = (v: bigint) =>
  "$" + (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtAddr = (a: string) => a.slice(0, 6) + "..." + a.slice(-4);

export const fmtDuration = (ms: number) => {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

// ── Telegram ──
const TELEGRAM_BOT = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || "";

export async function alert(msg: string, level: "INFO" | "WARN" | "CRIT" = "INFO") {
  const icon = level === "CRIT" ? "\u{1F534}" : level === "WARN" ? "\u{1F7E1}" : "\u{1F7E2}";
  const text = `${icon} *CUSTOS*\n\n${msg}\n\n_${new Date().toISOString()}_`;
  console.log(`[CUSTOS ${level}] ${msg.split("\n")[0]}`);

  if (TELEGRAM_BOT && TELEGRAM_CHAT) {
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: "Markdown", disable_web_page_preview: true }),
      });
    } catch (e: any) {
      console.error("  Telegram failed:", e.message);
    }
  }
}

// ── Skill Interface ──
export interface SkillStats {
  name: string;
  runs: number;
  actions: number;
  errors: number;
  lastRun: number;
  details: Record<string, string>;
}

export interface Skill {
  name: string;
  run(): Promise<void>;
  stats(): SkillStats;
}

// ── Multicall Batching ──
// Multicall3 is deployed at the same address on every EVM chain
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;

const MULTICALL3_ABI = [
  {
    name: "aggregate3",
    type: "function",
    inputs: [{ name: "calls", type: "tuple[]", components: [
      { name: "target", type: "address" },
      { name: "allowFailure", type: "bool" },
      { name: "callData", type: "bytes" },
    ]}],
    outputs: [{ name: "returnData", type: "tuple[]", components: [
      { name: "success", type: "bool" },
      { name: "returnData", type: "bytes" },
    ]}],
    stateMutability: "view",
  },
] as const;

import { encodeFunctionData, decodeFunctionResult } from "viem";

interface BatchCall {
  address: Address;
  abi: readonly any[];
  functionName: string;
  args?: any[];
}

export async function multicall(calls: BatchCall[]): Promise<any[]> {
  const encodedCalls = calls.map(c => ({
    target: c.address,
    allowFailure: true,
    callData: encodeFunctionData({
      abi: c.abi,
      functionName: c.functionName,
      args: c.args || [],
    }),
  }));

  const results = await client.readContract({
    address: MULTICALL3,
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    args: [encodedCalls],
  }) as { success: boolean; returnData: `0x${string}` }[];

  return results.map((r, i) => {
    if (!r.success) return null;
    try {
      return decodeFunctionResult({
        abi: calls[i].abi,
        functionName: calls[i].functionName,
        data: r.returnData,
      });
    } catch { return null; }
  });
}
