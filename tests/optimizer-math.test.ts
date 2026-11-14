import { describe, expect, it } from "vitest";
import { mockSnapshot, deepLiquiditySnapshot } from "./helpers/mock-snapshot";
import { runOptimizer, gasCostSusdc, DEFAULT_MIN_NET_GAIN_SUSDC } from "@/lib/optimizer/yield-optimizer";
import type { OptimizerInput } from "@/lib/optimizer/types";

const input = (patch: Partial<OptimizerInput> = {}): OptimizerInput => ({
  sourceVenue: "harbor", amountSusdc: 5000, holdingPeriodDays: 90,
  minNetGainSusdc: 2, apyBasis: "effective", ...patch,
});

describe("gas and fee arithmetic", () => {
  it("enforces the 0.04 floor and reports actual wei", () => {
    expect(gasCostSusdc("10000000000", 285000)).toEqual({ susdc: .04, weiRaw: "2850000000000000", phrs: .00285, floored: true });
  });
  it("uses live gas above the floor", () => expect(gasCostSusdc("200000000000", 285000).susdc).toBeCloseTo(.057));
  it("quotes approve+deposit only for idle capital", () => {
    const result = runOptimizer(input({ sourceVenue: "wallet_idle" }), mockSnapshot());
    expect(result.best!.gasUnits).toBe(190000);
    expect(result.best!.sourceExitFeeSusdc).toBe(0);
  });
  it("quotes guarded execution gas separately from a direct deposit", () => {
    const best = runOptimizer(input({ sourceVenue: "wallet_idle", executionRoute: "guarded" }), mockSnapshot()).best!;
    expect(best.gasUnits).toBe(275000);
  });
  it("charges source exit on full amount and entry on net proceeds", () => {
    const credit = runOptimizer(input(), mockSnapshot()).candidates.find((c) => c.venueId === "credit")!;
    expect(credit.sourceExitFeeSusdc).toBe(2.5);
    expect(credit.targetEntryFeeSusdc).toBeCloseTo(5.997, 9);
    expect(credit.totalSwitchingCostSusdc).toBeCloseTo(8.537, 9);
  });
  it("staying has zero gas, fees, dilution and net gain", () => {
    const source = runOptimizer(input(), mockSnapshot()).candidates.find((c) => c.isSource)!;
    expect([source.estimatedGasCostSusdc, source.totalSwitchingCostSusdc, source.modeledDilutionBps, source.expectedNetGainSusdc]).toEqual([0, 0, 0, 0]);
  });
});

describe("full-source-principal model with real post-allocation dilution", () => {
  it("uses independently calculated target and source income", () => {
    const snapshot = mockSnapshot();
    const credit = runOptimizer(input(), snapshot).candidates.find((c) => c.venueId === "credit")!;
    const tvl = snapshot.vaults.find((v) => v.id === "credit")!.totalAssetsSusdc;
    const rate = 983 * tvl / (tvl + 5000);
    const targetYield = 4991.503 * rate / 10000 * 90 / 365;
    const sourceYield = 5000 * .074 * 90 / 365;
    expect(credit.chosenApyBps).toBeCloseTo(rate, 10);
    expect(credit.sourceProjectedYieldSusdc).toBeCloseTo(sourceYield, 10);
    expect(credit.targetGrossYieldSusdc).toBeCloseTo(targetYield, 10);
    expect(credit.expectedNetGainSusdc).toBeCloseTo(targetYield - sourceYield - 8.537, 10);
  });
  it("changes the verdict when allocation materially dilutes the target", () => {
    expect(runOptimizer(input(), deepLiquiditySnapshot()).verdict).toBe("REBALANCE_RECOMMENDED");
    expect(runOptimizer(input(), mockSnapshot()).verdict).toBe("STAY_PUT");
  });
  it("zero TVL implies zero modeled fixed-revenue rate, not a guessed APY", () => {
    const snap = mockSnapshot(); snap.vaults.find((v) => v.id === "credit")!.totalAssetsSusdc = 0;
    expect(runOptimizer(input(), snap).candidates.find((c) => c.venueId === "credit")!.chosenApyBps).toBe(0);
  });
  it("does not dilute the current position a second time", () => {
    const result = runOptimizer(input(), mockSnapshot());
    expect(result.sourceEffectiveApyBps).toBe(740);
    expect(result.candidates.find((c) => c.isSource)!.chosenApyBps).toBe(740);
  });
  it("switches exploratory base and effective input before TVL dilution", () => {
    const snap = mockSnapshot();
    const base = runOptimizer(input({ apyBasis: "base" }), snap).candidates.find((c) => c.venueId === "credit")!;
    const eff = runOptimizer(input(), snap).candidates.find((c) => c.venueId === "credit")!;
    expect(base.chosenApyBps / eff.chosenApyBps).toBeCloseTo(1020 / 983, 10);
  });
  it("source idle has zero opportunity-cost yield", () => expect(runOptimizer(input({ sourceVenue: "wallet_idle" }), mockSnapshot()).best!.sourceProjectedYieldSusdc).toBe(0));
  it("break-even is the exact zero crossing under asymmetric principals", () => {
    const best = runOptimizer(input(), deepLiquiditySnapshot()).best!;
    expect(best.dailyYieldAdvantageSusdc * best.breakEvenDays - best.totalSwitchingCostSusdc).toBeCloseTo(0, 10);
    expect(best.breakEvenDays).toBeGreaterThan(25);
  });
  it("nonpositive daily edge never breaks even", () => expect(runOptimizer(input(), mockSnapshot()).candidates.find((c) => c.venueId === "credit")!.breakEvenDays).toBe(Infinity));
});

describe("quantitative verdicts", () => {
  it("recommends only after break-even and hurdle", () => {
    const result = runOptimizer(input(), deepLiquiditySnapshot());
    expect(result.verdict).toBe("REBALANCE_RECOMMENDED"); expect(result.checks.every((c) => c.passed)).toBe(true);
  });
  it("rejects a short horizon", () => expect(runOptimizer(input({ sourceVenue: "tbill", holdingPeriodDays: 14 }), deepLiquiditySnapshot()).verdictCode).toBe("HOLDING_PERIOD_TOO_SHORT"));
  it("rejects a hurdle larger than projected net income", () => expect(runOptimizer(input({ minNetGainSusdc: 25 }), deepLiquiditySnapshot()).verdictCode).toBe("NET_GAIN_BELOW_HURDLE"));
  it("recognizes the optimal current source and quantifies alternatives", () => {
    const result = runOptimizer(input({ sourceVenue: "credit" }), deepLiquiditySnapshot());
    expect(result.verdictCode).toBe("ALREADY_IN_OPTIMAL_VAULT"); expect(result.bestAlternative!.expectedNetGainSusdc).toBeLessThan(0);
  });
  it("micro positions stay put with a quantitative hurdle", () => {
    const result = runOptimizer(input({ amountSusdc: 50, holdingPeriodDays: 7 }), deepLiquiditySnapshot());
    expect(result.verdict).toBe("STAY_PUT"); expect(result.reason).toContain("2.00 sUSDC minimum rebalance hurdle");
  });
  it("sorts every candidate by net gain", () => {
    const nets = runOptimizer(input(), mockSnapshot()).candidates.map((c) => c.expectedNetGainSusdc);
    expect(nets).toEqual([...nets].sort((a, b) => b - a));
  });
  it("default hurdle is 2 sUSDC", () => expect(DEFAULT_MIN_NET_GAIN_SUSDC).toBe(2));
});

describe("fail-closed integrity", () => {
  for (const amount of [0, -1, NaN, Infinity]) it(`rejects invalid amount ${amount}`, () => expect(runOptimizer(input({ amountSusdc: amount }), mockSnapshot()).verdict).toBe("STAY_PUT"));
  it("rejects nonfinite horizon or negative hurdle", () => {
    expect(runOptimizer(input({ holdingPeriodDays: Infinity }), mockSnapshot()).best).toBeNull();
    expect(runOptimizer(input({ minNetGainSusdc: -1 }), mockSnapshot()).best).toBeNull();
  });
  it("does not invent a zero-APY source when its read fails", () => {
    const snap = mockSnapshot(); snap.vaults = snap.vaults.filter((v) => v.id !== "harbor");
    expect(runOptimizer(input(), snap).reason).toContain("source vault is unreadable");
  });
  it("handles a sole readable source without crashing", () => {
    const snap = mockSnapshot(); snap.vaults = snap.vaults.filter((v) => v.id === "harbor");
    expect(runOptimizer(input(), snap).verdict).toBe("STAY_PUT");
  });
  it("excludes paused targets", () => {
    const snap = deepLiquiditySnapshot(); snap.vaults.find((v) => v.id === "credit")!.paused = true;
    expect(runOptimizer(input(), snap).best!.venueId).toBe("tbill");
  });
  it("handles all paused, no venues and wrong chain", () => {
    const snap = mockSnapshot(); snap.vaults.forEach((v) => { v.paused = true; });
    expect(runOptimizer(input(), snap).best).toBeNull();
    snap.vaults = []; expect(runOptimizer(input(), snap).reason).toContain("No yield venue");
    snap.chainId = 1; expect(runOptimizer(input(), snap).verdict).toBe("STAY_PUT");
  });
});
