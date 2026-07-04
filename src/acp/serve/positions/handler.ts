// ═══════════════════════════════════════════════════════════════════════════
//  ACP Resource — "Managed Positions"
//
//  Read-only endpoint so any client (or observer) can verify CUSTOS's custody:
//  total AUM, caps, and every open/closed position with its shares and yield.
//  This is what makes fund-transfer trustworthy — the ledger is queryable.
//
//  Register:  acp resource create --from-file src/acp/serve/positions/resource.json
//  or serve via the Arcis MCP (mcp.arcis.money).
// ═══════════════════════════════════════════════════════════════════════════

import { positionsResource } from "../../positions.js";

type ResourceHandler = (input?: { positionId?: string }) => Promise<unknown>;

const handler: ResourceHandler = async (input) => {
  const snapshot = await positionsResource();
  if (input?.positionId) {
    const one = snapshot.positions.find((p) => p.id === input.positionId);
    return one ? { ...snapshot, positions: [one] } : { error: "not found", positionId: input.positionId };
  }
  return snapshot;
};

export default handler;
