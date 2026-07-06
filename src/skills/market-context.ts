// @ts-nocheck — x402 deps are dynamically imported (env-gated); types resolve after `npm i @x402/axios @x402/evm axios`.
// ═══════════════════════════════════════════════════════════════════════════
//  skills/market-context.ts — CUSTOS reads the market via CoinMarketCap x402
//
//  CUSTOS pays $0.01 USDC per call on Base (EIP-3009 transferWithAuthorization,
//  handled by the x402 client) from its OWN keeper wallet — the same account it
//  already uses for on-chain actions. This is the Arcis thesis, dogfooded:
//  an agent earns USDC, keeps it working in the vault, and spends a sliver of it
//  on live data. It never touches a user's treasury.
//
//  Guardrails:
//   • Off by default. Only runs when CMC_X402=true AND a keeper key is present.
//   • TTL-cached (10 min) so repeated questions don't re-pay.
//   • Fails soft — any error degrades to "unavailable", never crashes the keeper.
//
//  Verified against @x402/axios@2.17 + @x402/evm@2.17 real exports
//  (x402Client.register + wrapAxiosWithPayment + ExactEvmScheme) — the CMC
//  SKILL.md example (createX402AxiosClient) is stale for v2 and does NOT work.
// ═══════════════════════════════════════════════════════════════════════════

import { privateKeyToAccount } from "viem/accounts";

const ENABLED = /^(1|true|yes|on)$/i.test(process.env.CMC_X402 || "");
const PK = process.env.CUSTOS_PRIVATE_KEY as `0x${string}` | undefined;
const TTL_MS = 10 * 60 * 1000;
const CMC_QUOTES = "https://pro.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest";

export interface MarketContext {
  enabled: boolean;
  error?: string;
  at?: number;
  regime?: "risk-on" | "neutral" | "risk-off";
  note?: string;
  btc?: { price?: number; ch24?: number; ch7?: number };
  eth?: { price?: number; ch24?: number; ch7?: number };
  summary?: string;
}

let cache: MarketContext | null = null;

export function marketContextEnabled(): boolean {
  return ENABLED && !!PK;
}

function coin(data: any, sym: string) {
  let e = data?.[sym];
  if (Array.isArray(e)) e = e[0];
  const q = e?.quote?.USD || {};
  return { price: q.price, ch24: q.percent_change_24h, ch7: q.percent_change_7d };
}

function regimeOf(btc: any, eth: any): { regime: "risk-on" | "neutral" | "risk-off"; note: string } {
  const m = ((btc.ch24 ?? 0) + (eth.ch24 ?? 0)) / 2; // avg 24h momentum
  const w = ((btc.ch7 ?? 0) + (eth.ch7 ?? 0)) / 2; // avg 7d momentum
  if (m <= -4 || w <= -8)
    return { regime: "risk-off", note: "Drawdown regime — holding a fuller liquid reserve keeps agent withdrawals instant while markets are volatile." };
  if (m >= 4 || w >= 8)
    return { regime: "risk-on", note: "Momentum regime — idle USDC is best put to work; the vault's Aave allocation earns while liquidity stays on tap." };
  return { regime: "neutral", note: "Range-bound — a steady deploy-and-reserve posture; nothing forcing a change." };
}

function fmt(btc: any, eth: any, regime: string, note: string): string {
  const p = (n: number) => (n == null ? "\u2014" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  const c = (n: number) => (n == null ? "" : ` (${n >= 0 ? "+" : ""}${Number(n).toFixed(1)}% 24h)`);
  return (
    `Market context \u2014 BTC ${p(btc.price)}${c(btc.ch24)}, ETH ${p(eth.price)}${c(eth.ch24)}. Regime: ${regime}.\n` +
    `${note}\n` +
    `Source: CoinMarketCap via x402 \u2014 paid on-chain in USDC on Base. Context only, not advice.`
  );
}

/**
 * getMarketContext — returns a cached/fresh market read, or a disabled/errored stub.
 * Spends $0.01 USDC (once per TTL window) only when CMC_X402=true and a key is present.
 */
export async function getMarketContext(force = false): Promise<MarketContext> {
  if (!marketContextEnabled()) return { enabled: false };
  if (!force && cache && cache.at && Date.now() - cache.at < TTL_MS) return cache;
  try {
    const [{ default: axios }, { wrapAxiosWithPayment, x402Client }, { ExactEvmScheme }] = await Promise.all([
      import("axios"),
      import("@x402/axios"),
      import("@x402/evm"),
    ]);
    const account = privateKeyToAccount(PK as `0x${string}`);
    const client = new x402Client().register("eip155:*", new ExactEvmScheme(account));
    const api = wrapAxiosWithPayment(axios.create({ timeout: 20000 }), client);

    const res = await api.get(CMC_QUOTES, { params: { symbol: "BTC,ETH" } });
    const data = res.data?.data || {};
    const btc = coin(data, "BTC");
    const eth = coin(data, "ETH");
    const { regime, note } = regimeOf(btc, eth);
    cache = { enabled: true, at: Date.now(), regime, note, btc, eth, summary: fmt(btc, eth, regime, note) };
    return cache;
  } catch (e: any) {
    return { enabled: true, error: e?.message || "x402 fetch failed" };
  }
}
