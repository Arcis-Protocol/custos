// ═══════════════════════════════════════════════════════════════════════════
//  rails.ts — fiat ⇄ USDC on/off ramps.
//
//  CUSTOS doesn't touch fiat itself (that needs a licensed, KYC'd provider). It
//  quotes and prepares ramp sessions against a configured provider's hosted
//  widget (the common apiKey + wallet + amount URL pattern), so the user
//  completes KYC and payment with the provider and USDC lands in / leaves their
//  own wallet on Base. Set RAMP_ONRAMP_URL / RAMP_OFFRAMP_URL + RAMP_API_KEY.
// ═══════════════════════════════════════════════════════════════════════════

const P = {
  name: process.env.RAMP_PROVIDER || "the ramp provider",
  apiKey: process.env.RAMP_API_KEY || "",
  onrampUrl: process.env.RAMP_ONRAMP_URL || "",
  offrampUrl: process.env.RAMP_OFFRAMP_URL || process.env.RAMP_ONRAMP_URL || "",
  feeBps: Number(process.env.RAMP_FEE_BPS || 100),
  network: process.env.RAMP_NETWORK || "base",
};
const round = (n: number) => Math.round(n * 100) / 100;

export const onrampConfigured = () => !!(P.onrampUrl && P.apiKey);
export const offrampConfigured = () => !!(P.offrampUrl && P.apiKey);

export function quoteOnramp(fiatAmount: number, fiatCcy = "USD") {
  const fee = fiatAmount * (P.feeBps / 10000);
  return { provider: P.name, youPayFiat: round(fiatAmount), fiatCcy, feeUsd: round(fee), youReceiveUsdc: round(fiatAmount - fee), rate: "≈1.00 USDC/USD", estimate: true, note: "Estimate — the provider returns the binding quote at checkout." };
}
export function quoteOfframp(usdcAmount: number, payoutCcy = "USD") {
  const fee = usdcAmount * (P.feeBps / 10000);
  return { provider: P.name, youSendUsdc: round(usdcAmount), feeUsd: round(fee), youReceiveFiat: round(usdcAmount - fee), payoutCcy, estimate: true, note: "Estimate — the provider returns the binding quote and payout timing." };
}

export function buildOnrampUrl(o: { wallet: string; amountUsd?: number; fiatCcy?: string }) {
  if (!onrampConfigured()) return { configured: false as const, note: "On-ramp provider not configured — set RAMP_ONRAMP_URL and RAMP_API_KEY." };
  const u = new URL(P.onrampUrl);
  u.searchParams.set("apiKey", P.apiKey);
  u.searchParams.set("walletAddress", o.wallet);
  u.searchParams.set("network", P.network);
  u.searchParams.set("cryptoCurrencyCode", "USDC");
  u.searchParams.set("fiatCurrency", o.fiatCcy || "USD");
  if (o.amountUsd) u.searchParams.set("fiatAmount", String(o.amountUsd));
  return { configured: true as const, provider: P.name, url: u.toString() };
}
export function buildOfframpUrl(o: { wallet: string; amountUsdc?: number; payoutCcy?: string }) {
  if (!offrampConfigured()) return { configured: false as const, note: "Off-ramp provider not configured — set RAMP_OFFRAMP_URL and RAMP_API_KEY." };
  const u = new URL(P.offrampUrl);
  u.searchParams.set("apiKey", P.apiKey);
  u.searchParams.set("walletAddress", o.wallet);
  u.searchParams.set("network", P.network);
  u.searchParams.set("cryptoCurrencyCode", "USDC");
  u.searchParams.set("productsAvailed", "SELL");
  u.searchParams.set("fiatCurrency", o.payoutCcy || "USD");
  if (o.amountUsdc) u.searchParams.set("cryptoAmount", String(o.amountUsdc));
  return { configured: true as const, provider: P.name, url: u.toString() };
}
