/**
 * All 5 one-click reviewer scenario chips must produce their expected
 * verdict class. Chip math uses the bounty sheet's parameter set
 * (credit diluted to 983 bps via apyBasis "effective") so the arithmetic is
 * deterministic regardless of live drift on the testnet.
 */
import { describe, it, expect } from "vitest";
import { mockSnapshot, deepLiquiditySnapshot } from "./helpers/mock-snapshot";
import { runOptimizer } from "@/lib/optimizer/yield-optimizer";
import { SCENARIOS } from "@/lib/optimizer/scenarios";
import type { OptimizerInput } from "@/lib/optimizer/types";

// SCENARIOS carries UI preset inputs (no apyBasis) — extend with the sheet basis.
const scenarioInput = (id: string): OptimizerInput => {
  const preset = SCENARIOS.find((s) => s.id === id)!;
  return { ...preset.input, apyBasis: "effective" };
};

describe("the 5 reviewer scenario chips", () => {
  it("chip ① Harbor → Senior Credit · 5,000 · 90d ⇒ REBALANCE_RECOMMENDED", () => {
    const result = runOptimizer(scenarioInput("rebalance"), deepLiquiditySnapshot());
    expect(result.verdict).toBe("REBALANCE_RECOMMENDED");
    expect(result.best!.venueId).toBe("credit");
    expect(result.best!.sourceExitFeeSusdc).toBeCloseTo(2.5, 2); // $2.50 exit
    expect(result.best!.targetEntryFeeSusdc).toBeCloseTo(6.0, 1); // ~$6.00 entry
    expect(result.best!.estimatedGasCostSusdc).toBe(0.04); // $0.04 gas
    expect(result.best!.expectedNetGainSusdc).toBeGreaterThan(20); // ≈ +$21.4
    expect(result.best!.breakEvenDays).toBeGreaterThan(25); // ≈ 25.7d
    expect(result.best!.breakEvenDays).toBeLessThan(26);
  });

  it("chip ② T-Bill → Senior Credit · 5,000 · 14d ⇒ STAY_PUT (horizon < break-even)", () => {
    const result = runOptimizer(scenarioInput("too-short"), deepLiquiditySnapshot());
    expect(result.verdict).toBe("STAY_PUT");
    expect(result.verdictCode).toBe("HOLDING_PERIOD_TOO_SHORT");
    expect(result.best!.breakEvenDays).toBeGreaterThan(26);
    expect(result.best!.expectedNetGainSusdc).toBeLessThan(-2.8);
    expect(result.input.holdingPeriodDays).toBeLessThan(
      Math.ceil(result.best!.breakEvenDays),
    );
  });

  it("chip ③ Senior Credit · 5,000 · 60d ⇒ STAY_PUT (already optimal)", () => {
    const result = runOptimizer(scenarioInput("already-optimal"), mockSnapshot());
    expect(result.verdict).toBe("STAY_PUT");
    expect(result.verdictCode).toBe("ALREADY_IN_OPTIMAL_VAULT");
    expect(result.best!.venueId).toBe("credit");
    expect(result.best!.isSource).toBe(true);
    // every alternative nets a loss over 60 days
    for (const c of result.candidates) {
      if (!c.isSource) expect(c.expectedNetGainSusdc).toBeLessThan(0);
    }
  });

  it("chip ④ Harbor → T-Bill · 50 · 7d ⇒ STAY_PUT (below hurdle / gas friction)", () => {
    const result = runOptimizer(scenarioInput("below-hurdle"), mockSnapshot());
    expect(result.verdict).toBe("STAY_PUT");
    // With the honest $0.04 gas floor + 5 bps exit fee, the 50 sUSDC / 7-day
    // micro-spread is negative — the engine reports the honest figure and the
    // reason text explicitly cites the 2.00 sUSDC hurdle (see README).
    expect(result.best!.expectedNetGainSusdc).toBeLessThan(0);
    expect(result.reason).toContain("minimum rebalance hurdle");
    expect(result.checks.find((c) => c.label === "Net gain clears hurdle")!.passed).toBe(false);
  });

  it("chip ⑤ Wallet idle → Best Vault · 3,000 · 45d ⇒ REBALANCE_RECOMMENDED", () => {
    const result = runOptimizer(scenarioInput("idle-deploy"), mockSnapshot());
    expect(result.verdict).toBe("REBALANCE_RECOMMENDED");
    expect(result.input.sourceVenue).toBe("wallet_idle");
    expect(result.best!.venueId).toBe("credit");
    expect(result.best!.expectedNetGainSusdc).toBeGreaterThan(20);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });
});

describe("verdict invariants across the full scenario matrix", () => {
  const snap = mockSnapshot();

  it("STAY_PUT verdicts always carry a reason code or degenerate reason", () => {
    for (const preset of SCENARIOS) {
      const result = runOptimizer(scenarioInput(preset.id), snap);
      if (result.verdict === "STAY_PUT") {
        expect(
          result.verdictCode !== null || result.reason.length > 0,
        ).toBe(true);
      }
    }
  });

  it("every REBALANCE verdict satisfies all three rubric conditions", () => {
    for (const preset of SCENARIOS) {
      const result = runOptimizer(scenarioInput(preset.id), snap);
      if (result.verdict === "REBALANCE_RECOMMENDED") {
        expect(result.best).not.toBeNull();
        expect(result.best!.isSource).toBe(false);
        expect(result.input.holdingPeriodDays).toBeGreaterThanOrEqual(
          Math.ceil(result.best!.breakEvenDays),
        );
        expect(result.best!.expectedNetGainSusdc).toBeGreaterThanOrEqual(
          result.input.minNetGainSusdc,
        );
        expect(result.checks.every((c) => c.passed)).toBe(true);
      }
    }
  });
});
