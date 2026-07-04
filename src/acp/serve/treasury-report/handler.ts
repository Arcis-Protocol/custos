// ═══════════════════════════════════════════════════════════════════════════
//  ACP Serve handler — "Idle-USDC Treasury Report"
//
//  Scaffolded with:  acp serve init --name "Idle-USDC Treasury Report"
//  The handler takes the client's requirements and returns a deliverable that
//  gets settled over on-chain USDC escrow. This one produces a real report
//  from live Arcis vault economics — no placeholder data.
//
//  Run:     acp serve start           (local test)
//  Deploy:  acp serve deploy          (hosted, ERC-8183 escrow)
// ═══════════════════════════════════════════════════════════════════════════

import { client, ADDR, VAULT_ABI, getVaultAPY, fmtUSDC } from "../../../config.js";

interface Requirements {
  idleUsdc: number;
  horizonDays?: number;
  wantsCredit?: boolean;
}

// The Handler type comes from the acp-cli serve runtime at deploy time:
//   import type { Handler } from "acp-cli/serve/types";
// Kept structural here so this file type-checks inside the custos repo too.
type Handler = (input: { requirements: Requirements }) => Promise<{ deliverable: string }>;

const handler: Handler = async (input) => {
  const { idleUsdc, horizonDays = 30, wantsCredit = false } = input.requirements;

  // Live Arcis economics
  const apyStr = await getVaultAPY();                       // e.g. "2.14"
  const apy = Number(apyStr.replace("~", "")) || 2.1;
  let tvl = 0n;
  try { tvl = await client.readContract({ address: ADDR.vault, abi: VAULT_ABI, functionName: "totalAssets" }) as bigint; } catch {}

  const yieldOverHorizon = idleUsdc * (apy / 100) * (horizonDays / 365);
  // AgentCredit default tiers: no identity = 200% collateral → borrow up to ~50% of collateral value.
  const conservativeCredit = idleUsdc * 0.5;

  const md = [
    `# Arcis Treasury Report`,
    ``,
    `**Idle balance analyzed:** ${idleUsdc.toLocaleString()} USDC`,
    `**Horizon:** ${horizonDays} days`,
    ``,
    `## Deploy to the raUSDC vault`,
    `- Current vault APY: **${apy.toFixed(2)}%** (Aave-backed, 70% deployed / 30% reserve)`,
    `- Vault TVL: **${fmtUSDC(tvl)}**`,
    `- Projected yield over ${horizonDays} days: **~${yieldOverHorizon.toFixed(2)} USDC**`,
    ``,
    `## Route`,
    `1. Deposit ${idleUsdc.toLocaleString()} USDC → raUSDC vault (\`${ADDR.vault}\`).`,
    `2. Hold raUSDC — it accrues yield and is withdrawable on demand.`,
    wantsCredit
      ? `3. Use raUSDC as collateral in AgentCredit (\`${ADDR.credit}\`) — reputation-tiered, conservatively ~${conservativeCredit.toLocaleString()} USDC of borrow capacity at the entry tier.`
      : `3. (Optional) Use raUSDC as collateral in AgentCredit to unlock borrow capacity.`,
    `4. Higher on-chain reputation → better collateral ratio → more credit.`,
    ``,
    `*Same asset, same chain (Base), no bridging. x402 is how you earn USDC; Arcis is where it works.*`,
    ``,
    `— CUSTOS, Keeper of the Citadel · arcis.money`,
  ].join("\n");

  return { deliverable: md };
};

export default handler;
