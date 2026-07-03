// ═══════════════════════════════════════════════════════════════════════════
//  TreasuryAccumulator — CUSTOS's autonomous treasury loop.
//
//  accumulate $CUSTOS (Virtuals curve) → deposit to raCUSTOS vault →
//  report on-chain credit capacity → disclose everything.
//
//  Transparent by design: every cycle is announced with tx links and live
//  graduation progress. Dry-run by default; live only when explicitly enabled
//  and preflight passes.
// ═══════════════════════════════════════════════════════════════════════════

import { type Skill, type SkillStats, alert, getWallet } from "../config.js";
import * as treasury from "../treasury.js";

const bar = (pct: number, width = 20) => {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
};

export class TreasuryAccumulator implements Skill {
  name = "TreasuryAccumulator";
  private runs = 0;
  private actions = 0;
  private errors = 0;
  private lastRun = 0;
  private paused = false;
  private last: treasury.StepResult | null = null;

  async run(): Promise<void> {
    this.runs++;
    this.lastRun = Date.now();
    try {
      if (this.paused) return;
      const res = await treasury.accumulateStep();
      this.last = res;

      // Only announce when something meaningful happened (a buy, a halt, or a live action).
      if (res.action === "buy" || res.action === "buy+deposit") {
        this.actions++;
        await this.announce(res);
      } else if (res.action === "halt") {
        await alert(`Treasury accumulation halted — ${res.reason}`, "WARN");
      }
      // "skip" cycles (cooldown/cap/disabled) stay silent to avoid noise.
    } catch (e: any) {
      this.errors++;
      await alert(`TreasuryAccumulator error: ${e.message?.slice(0, 120)}`, "WARN");
    }
  }

  private async announce(res: treasury.StepResult) {
    const p = res.progress;
    const tag = res.dryRun ? "DRY RUN" : "LIVE";
    const lines: string[] = [];
    lines.push(`*Treasury Accumulation* — ${tag}`);
    lines.push("");
    if (res.dryRun) {
      lines.push(res.reason || "simulated cycle");
    } else {
      lines.push(`Bought *${res.spentVirtual} VIRTUAL* → *${res.acquiredCustos.toFixed(2)} CUSTOS*`);
      if (res.depositedCustos > 0)
        lines.push(`Deposited *${res.depositedCustos.toFixed(2)} CUSTOS* → *${res.sharesReceived.toFixed(2)} raCUSTOS*`);
      if (res.buyTx) lines.push(`buy: ${treasury.txUrl(res.buyTx)}`);
      if (res.depositTx) lines.push(`deposit: ${treasury.txUrl(res.depositTx)}`);
    }
    lines.push("");
    lines.push(`Graduation: ${bar(p.pct)} ${p.pct.toFixed(1)}%`);
    lines.push(`≈ ${p.raisedVirtual.toLocaleString("en-US", { maximumFractionDigits: 0 })} / ${p.target.toLocaleString()} VIRTUAL`);
    await alert(lines.join("\n"), "INFO");
  }

  // ── Public control surface (Telegram / ops) ──
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  isPaused() { return this.paused; }

  /** Force one cycle now (respects dry-run + all guards). */
  async triggerOnce(): Promise<treasury.StepResult> {
    const res = await treasury.accumulateStep();
    this.last = res;
    if (res.action === "buy" || res.action === "buy+deposit") { this.actions++; await this.announce(res); }
    return res;
  }

  /** Human-readable status for the Telegram /treasury command. */
  async statusText(): Promise<string> {
    const s = treasury.loadState();
    const p = await treasury.graduationProgress();
    const wallet = getWallet();
    const T = treasury.T;
    const lines: string[] = [];
    lines.push("*CUSTOS Treasury — Agentic Accumulation*");
    lines.push("");
    lines.push(`Mode: ${!T.enabled ? "disabled" : T.dryRun ? "DRY RUN" : "LIVE"}${this.paused ? " (paused)" : ""}`);
    lines.push(`Per buy: ${T.perBuyVirtual} VIRTUAL · every ${Math.round(T.intervalMs / 60000)}m`);
    lines.push(`Budget: ${Number(s.spentWei) / 1e18}/${T.budgetVirtual} VIRTUAL · daily cap ${T.dailyCapVirtual}`);
    lines.push("");
    lines.push(`Acquired: ${(Number(s.acquiredWei) / 1e18).toFixed(2)} CUSTOS`);
    lines.push(`Vaulted:  ${(Number(s.depositedWei) / 1e18).toFixed(2)} CUSTOS → ${(Number(s.sharesWei) / 1e18).toFixed(2)} raCUSTOS`);
    lines.push(`Buys: ${s.buys}`);
    lines.push("");
    lines.push(`Graduation: ${bar(p.pct)} ${p.pct.toFixed(1)}%`);
    lines.push(`≈ ${p.raisedVirtual.toLocaleString("en-US", { maximumFractionDigits: 0 })} / ${p.target.toLocaleString()} VIRTUAL`);
    if (wallet) {
      const cap = await treasury.creditCapacity(wallet.account.address);
      lines.push("");
      lines.push(`Credit ratio: ${(cap.ratioBps / 100).toFixed(0)}% · raCUSTOS collateral: ${(Number(cap.sharesWei) / 1e18).toFixed(2)}`);
    }
    return lines.join("\n");
  }

  stats(): SkillStats {
    const s = treasury.loadState();
    return {
      name: this.name,
      runs: this.runs,
      actions: this.actions,
      errors: this.errors,
      lastRun: this.lastRun,
      details: {
        mode: !treasury.T.enabled ? "disabled" : treasury.T.dryRun ? "dry-run" : "live",
        paused: String(this.paused),
        buys: String(s.buys),
        acquiredCustos: (Number(s.acquiredWei) / 1e18).toFixed(2),
        vaultedShares: (Number(s.sharesWei) / 1e18).toFixed(2),
        lastAction: this.last?.action || "none",
      },
    };
  }
}
