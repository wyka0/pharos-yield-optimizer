import type { SourceVenueId } from "@/lib/contracts";
export interface ScenarioPreset {
  id: string; title: string; subtitle: string;
  expected: "REBALANCE_RECOMMENDED" | "STAY_PUT";
  input: { sourceVenue: SourceVenueId; amountSusdc: number; holdingPeriodDays: number; minNetGainSusdc: number };
}
/** Illustrative bounty presets; live verdicts are not constrained to these labels. */
export const SCENARIOS: ScenarioPreset[] = [
  { id: "rebalance", title: "① Rebalance Recommended", subtitle: "Illustration: Harbor 7.40% → Credit 9.83% · 5,000 sUSDC · 90 days", expected: "REBALANCE_RECOMMENDED", input: { sourceVenue: "harbor", amountSusdc: 5000, holdingPeriodDays: 90, minNetGainSusdc: 2 } },
  { id: "too-short", title: "② Stay Put — Horizon < Break-Even", subtitle: "Illustration: T-Bill 8.15% → Credit 9.83% · 5,000 sUSDC · 14 days", expected: "STAY_PUT", input: { sourceVenue: "tbill", amountSusdc: 5000, holdingPeriodDays: 14, minNetGainSusdc: 2 } },
  { id: "already-optimal", title: "③ Stay Put — Already Optimal", subtitle: "Illustration: Credit 9.83% · 5,000 sUSDC · 60 days", expected: "STAY_PUT", input: { sourceVenue: "credit", amountSusdc: 5000, holdingPeriodDays: 60, minNetGainSusdc: 2 } },
  { id: "below-hurdle", title: "④ Stay Put — Below Hurdle / Gas Friction", subtitle: "Illustration: Harbor 7.40% → T-Bill 8.15% · 50 sUSDC · 7 days", expected: "STAY_PUT", input: { sourceVenue: "harbor", amountSusdc: 50, holdingPeriodDays: 7, minNetGainSusdc: 2 } },
  { id: "idle-deploy", title: "⑤ Deploy Idle Wallet sUSDC", subtitle: "Wallet idle 0% → Best Vault · 3,000 sUSDC · 45 days", expected: "REBALANCE_RECOMMENDED", input: { sourceVenue: "wallet_idle", amountSusdc: 3000, holdingPeriodDays: 45, minNetGainSusdc: 2 } },
];
