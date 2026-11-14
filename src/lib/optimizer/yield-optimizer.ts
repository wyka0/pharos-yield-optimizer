/**
 * Pharos Apex — Horizon-Aware Net-Yield & Break-Even Optimizer Engine.
 *
 * PURE function: (OptimizerInput, OptimizerSnapshot) → OptimizerResult.
 * No RPC, no wallet, no I/O — every live parameter arrives via the
 * block-pinned snapshot so the engine is deterministic and unit-testable.
 *
 * Requirement 01 — compares all 3 live yield venues (effectiveApyBps,
 *   fees, TVL read on-chain at one pinned block).
 * Requirement 02 — models gas (live eth_gasPrice × route units, $0.04 floor),
 *   entry/exit fees, and enforces a minimum holding period via the
 *   break-even horizon before ever recommending a move.
 * Requirement 03 — outputs a clear REBALANCE_RECOMMENDED verdict with the
 *   expected net gain, or STAY_PUT with an exact, quantitative reason.
 *
 * Yield model (documented in ARCHITECTURE.md):
 *   P            = amount − sourceExitFee − targetEntryFee   (post-fee principal)
 *   targetApy    = liveApy × TVL / (TVL + amount) (fixed-revenue model)
 *   dailyEdge    = (P × targetApy − amount × sourceApy) / 10_000 / 365
 *   advantage(d) = dailyEdge × d
 *   net(d)       = advantage(d) − (exitFee + entryFee + gas)
 *   breakEven    = switchingCost / dailyEdge                 (∞ when ΔAPY ≤ 0)
 * net(d) crosses zero exactly at breakEven — the model is internally
 * consistent. Live deployment state, not illustrative totals, drives verdicts.
 */
import {
  GAS_COST_FLOOR_SUSDC,
  GAS_UNITS,
  PHAROS_CHAIN_ID,
  PHRS_USD_REFERENCE_PRICE,
  TOTAL_REBALANCE_GAS_UNITS,
  venueById,
  type SourceVenueId,
  type VenueId,
} from "@/lib/contracts";
import type {
  CandidateEvaluation,
  OptimizerInput,
  OptimizerResult,
  OptimizerSnapshot,
  VaultLive,
  VerdictCheck,
} from "./types";

export const DEFAULT_MIN_NET_GAIN_SUSDC = 2.0;
export const BPS_DEN = 10_000;
const DAYS_PER_YEAR = 365;

/* ------------------------------ small utils ------------------------------- */

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "6.00" — fixed 2-decimal money string (no sign logic). */
export function money2(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "+21.38" / "-2.82" — explicit ASCII sign, 2 decimals (bounty-sheet style). */
export function signedMoney2(value: number): string {
  const rounded = round2(value);
  if (rounded > 0) return `+${money2(rounded)}`;
  if (rounded < 0) return `-${money2(Math.abs(rounded))}`;
  return "0.00";
}

/** One-decimal day count, e.g. "26.3". */
export function days1(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  return (Math.round(value * 10) / 10).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function bpsToPct(bps: number): string {
  return (bps / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ------------------------------ gas pricing ------------------------------- */

/**
 * Convert the live gas quote (wei) into the sUSDC friction figure.
 * wei → PHRS (/1e18) → sUSDC via the reference price, with a hard floor so
 * gas friction is ALWAYS visibly accounted for (bounty spec: $0.04 floor).
 */
export function gasCostSusdc(gasPriceWei: string, gasUnits: number): {
  susdc: number;
  weiRaw: string;
  phrs: number;
  floored: boolean;
} {
  const wei = BigInt(gasPriceWei) * BigInt(gasUnits);
  const phrs = Number(wei) / 1e18;
  const rawSusdc = phrs * PHRS_USD_REFERENCE_PRICE;
  const floored = rawSusdc < GAS_COST_FLOOR_SUSDC;
  return {
    susdc: floored ? GAS_COST_FLOOR_SUSDC : rawSusdc,
    weiRaw: wei.toString(),
    phrs,
    floored,
  };
}

function gasUnitsForRoute(sourceVenue: SourceVenueId, route: OptimizerInput["executionRoute"]): number {
  if (route === "guarded") return GAS_UNITS.approve + 220_000 + (sourceVenue === "wallet_idle" ? 0 : GAS_UNITS.redeem);
  // From idle wallet there is nothing to redeem: approve + deposit only.
  return sourceVenue === "wallet_idle"
    ? GAS_UNITS.approve + GAS_UNITS.deposit
    : TOTAL_REBALANCE_GAS_UNITS;
}

/* ------------------------------ main engine ------------------------------- */

export function runOptimizer(
  input: OptimizerInput,
  snapshot: OptimizerSnapshot,
): OptimizerResult {
   const amount = input.amountSusdc;
   const days = Math.min(365, Math.max(1, Math.round(input.holdingPeriodDays)));
  const hurdle = input.minNetGainSusdc;

  const sourceVault =
    input.sourceVenue === "wallet_idle"
      ? null
      : snapshot.vaults.find((v) => v.id === input.sourceVenue) ?? null;

  const sourceLabel =
    input.sourceVenue === "wallet_idle"
      ? "Wallet idle sUSDC"
      : (sourceVault?.shortLabel ?? venueById(input.sourceVenue).shortLabel);
  const sourceShortLabel =
    input.sourceVenue === "wallet_idle" ? "Wallet (idle)" : (sourceVault?.shortLabel ?? "source");
  const chosenApy = (v: VaultLive): number =>
    input.apyBasis === "effective" ? v.effectiveApyBps : v.baseApyBps;
  const sourceApyBps = sourceVault ? chosenApy(sourceVault) : 0;
  const sourcePositionSusdc = sourceVault ? sourceVault.userAssetsSusdc : null;
  const walletIdleSusdc = snapshot.wallet ? snapshot.wallet.susdc : null;

  /* -------- Degenerate guard: nothing usable to compare against -------- */
   const invalidInput = !Number.isFinite(amount) || amount <= 0 ||
     !Number.isFinite(input.holdingPeriodDays) || !Number.isFinite(hurdle) || hurdle < 0;
   const missingSource = input.sourceVenue !== "wallet_idle" && !sourceVault;
   if (snapshot.vaults.length === 0 || invalidInput || missingSource || snapshot.chainId !== PHAROS_CHAIN_ID) {
    return {
      input: { ...input, holdingPeriodDays: days },
      sourceLabel,
      sourceShortLabel,
      sourceEffectiveApyBps: sourceApyBps,
      sourcePositionSusdc,
      walletIdleSusdc,
      verdict: "STAY_PUT",
      verdictCode: null,
      reason:
         invalidInput ? "Stay Put — amount must be finite and positive, horizon finite, and hurdle finite and non-negative."
         : missingSource && snapshot.vaults.length > 0 ? "Stay Put — the source vault is unreadable. Its APY and exit fee cannot be assumed to be zero."
         : snapshot.chainId !== PHAROS_CHAIN_ID ? "Stay Put — snapshot chain does not match Pharos Atlantic."
         : "No yield venue could be read at the pinned block. Stay Put — no values are guessed.",
      best: null,
      bestAlternative: null,
      candidates: [],
      checks: [],
      snapshotBlockNumber: snapshot.blockNumber,
      gasPriceWei: snapshot.gasPriceWei,
    };
  }

  /* -------- Evaluate every candidate venue as a move target -------- */
   const gasUnits = gasUnitsForRoute(input.sourceVenue, input.executionRoute);
  const gas = gasCostSusdc(snapshot.gasPriceWei, gasUnits);

  const candidates: CandidateEvaluation[] = [];
  for (const vault of snapshot.vaults) {
    // Paused venues cannot accept deposits — excluded as move targets
    // (they still appear in the comparison table with a paused badge).
    if (vault.paused) continue;
    candidates.push(
      evaluateCandidate({
        vault,
        isSource: input.sourceVenue === vault.id,
        amount,
        days,
        sourceApyBps,
        sourceExitFeeBps: sourceVault ? sourceVault.exitFeeBps : 0,
        fromIdle: input.sourceVenue === "wallet_idle",
        gasSusdc: gas.susdc,
        gasWeiRaw: gas.weiRaw,
        gasUnits,
        hurdle,
        apyBasis: input.apyBasis,
      }),
    );
  }
  candidates.sort((a, b) => b.expectedNetGainSusdc - a.expectedNetGainSusdc);

  // The best MOVE target is the highest-net non-source candidate that can
  // actually amortize (positive daily yield edge). A candidate whose edge is
  // ≤ 0 never breaks even at ANY horizon — it is not a move, it's a donation.
  const viableMoves = candidates.filter(
    (c) => !c.isSource && c.dailyYieldAdvantageSusdc > 0,
  );
   const bestAlternative = candidates.find((c) => !c.isSource) ?? null;
   const bestMove =
    viableMoves.length > 0
      ? viableMoves.reduce((a, b) =>
          b.expectedNetGainSusdc > a.expectedNetGainSusdc ? b : a,
        )
      : null;
  const sourceEval = candidates.find((c) => c.isSource) ?? null;

  /* -------- Verdict + reason (Requirement 03) -------- */
  let verdict: OptimizerResult["verdict"] = "STAY_PUT";
  let verdictCode: OptimizerResult["verdictCode"] = null;
  let reason: string;
  let best: CandidateEvaluation | null = bestMove;

  if (candidates.length === 0) {
    best = null;
    reason =
      "Stay Put — every candidate venue is paused or unreadable at the pinned block, " +
      "so there is no executable target. Nothing is guessed.";
  } else if (!bestMove) {
    // No alternative amortizes at any horizon → the source is the optimal venue.
    if (sourceEval) {
      verdictCode = "ALREADY_IN_OPTIMAL_VAULT";
      best = sourceEval;
       const alt = bestAlternative;
      reason =
        `Stay Put in ${sourceEval.shortLabel} (${bpsToPct(sourceEval.chosenApyBps)}% APY): ` +
         `You are already deployed in the highest net-yielding vault among readable targets under this allocation model. ` +
         (alt ?
        `Moving ${money2(amount)} sUSDC to ${alt.shortLabel} (${bpsToPct(alt.chosenApyBps)}% APY) ` +
        `over ${days} days would reduce net earnings by ${signedMoney2(alt.expectedNetGainSusdc)} sUSDC ` +
        `after ${money2(alt.totalSwitchingCostSusdc)} sUSDC of switching costs ` +
         `(${money2(alt.sourceExitFeeSusdc)} exit + ${money2(alt.targetEntryFeeSusdc)} entry + ` +
         `${money2(alt.estimatedGasCostSusdc)} gas).` : "No alternative venue is readable or unpaused.");
    } else {
      best = candidates[0] ?? null;
      reason =
        `Stay Put in Wallet idle sUSDC (0.00% APY): No candidate venue out-yields 0% ` +
        `net of fees and gas at any horizon on the current live parameters — deploying ` +
        `capital would not pay for its own switching costs.`;
    }
  } else if (!(days >= Math.ceil(bestMove.breakEvenDays))) {
    verdictCode = "HOLDING_PERIOD_TOO_SHORT";
    const net = bestMove.expectedNetGainSusdc;
    const costParts =
      `${bestMove.entryFeeBps} bps entry fee (${money2(bestMove.targetEntryFeeSusdc)} sUSDC)` +
      (bestMove.sourceExitFeeSusdc > 0
        ? ` + ${sourceVault?.exitFeeBps ?? 0} bps ${sourceShortLabel} exit fee (${money2(bestMove.sourceExitFeeSusdc)} sUSDC)`
        : "") +
      ` + ${money2(bestMove.estimatedGasCostSusdc)} sUSDC gas`;
    const microClause =
      amount < 200
        ? ` On a ${money2(amount)} sUSDC position the ${money2(bestMove.totalSwitchingCostSusdc)} sUSDC ` +
          `switching cost dwarfs the ${money2(bestMove.grossYieldAdvantageSusdc)} sUSDC ` +
          `${days}-day yield spread — gas friction consumes the micro-spread.`
        : "";
    reason =
      `Stay Put in ${sourceShortLabel} (${bpsToPct(sourceApyBps)}% APY): Your ${days}-day ` +
      `holding period is shorter than the ${days1(bestMove.breakEvenDays)}-day break-even horizon ` +
      `required to recover ${bestMove.shortLabel}'s ${costParts}. Rebalancing for ${days} days ` +
      `would result in a net outcome of ${signedMoney2(net)} sUSDC — below your ` +
      `${money2(hurdle)} sUSDC minimum rebalance hurdle.${microClause}`;
  } else if (!(bestMove.expectedNetGainSusdc >= hurdle)) {
    verdictCode = "NET_GAIN_BELOW_HURDLE";
    best = bestMove;
    const exitDesc =
      bestMove.sourceExitFeeSusdc > 0
        ? `${sourceShortLabel}'s ${sourceVault?.exitFeeBps ?? 0} bps exit fee (${money2(bestMove.sourceExitFeeSusdc)} sUSDC)`
        : "no source exit fee";
    reason =
      `Stay Put in ${sourceShortLabel} (${bpsToPct(sourceApyBps)}% APY): On a ` +
      `${money2(amount)} sUSDC position over ${days} days, the net gain after ${exitDesc} ` +
      `${bestMove.targetEntryFeeSusdc > 0 ? `and ${bestMove.entryFeeBps} bps entry fee (${money2(bestMove.targetEntryFeeSusdc)} sUSDC) ` : ""}` +
      `and gas (${money2(bestMove.estimatedGasCostSusdc)} sUSDC) is ` +
      `${signedMoney2(bestMove.expectedNetGainSusdc)} sUSDC, which is below your ` +
      `${money2(hurdle)} sUSDC minimum rebalance hurdle.`;
  } else {
    verdict = "REBALANCE_RECOMMENDED";
    best = bestMove;
    reason =
      `Rebalance ${money2(amount)} sUSDC from ${sourceShortLabel} (${bpsToPct(sourceApyBps)}% APY) ` +
      `→ ${bestMove.shortLabel} (${bpsToPct(bestMove.chosenApyBps)}% APY). Expected net gain over ` +
      `${days} days: ${signedMoney2(bestMove.expectedNetGainSusdc)} sUSDC after ` +
      `${money2(bestMove.sourceExitFeeSusdc)} exit fee, ${money2(bestMove.targetEntryFeeSusdc)} entry fee and ` +
      `${money2(bestMove.estimatedGasCostSusdc)} gas (total switching cost ` +
      `${money2(bestMove.totalSwitchingCostSusdc)} sUSDC). Break-even in ${days1(bestMove.breakEvenDays)} days — ` +
      `your ${days}-day horizon clears it.`;
  }

  /* -------- Rubric condition checks (Requirement 03) -------- */
  const checks: VerdictCheck[] = [];
  if (verdictCode === "ALREADY_IN_OPTIMAL_VAULT") {
    const alt = candidates.find((c) => !c.isSource) ?? null;
    checks.push({
      label: "Already in the optimal venue",
      passed: true,
      detail:
        alt
          ? `${best?.shortLabel ?? sourceShortLabel} tops every alternative net of costs — the best alternative ` +
            `(${alt.shortLabel}) nets ${signedMoney2(alt.expectedNetGainSusdc)} sUSDC over ${days} days.`
          : "No alternative venue is readable.",
    });
  } else if (best) {
    checks.push({
      label: "Different target venue",
      passed: !best.isSource,
      detail: best.isSource
        ? `You are already deployed in ${best.shortLabel}.`
        : `Best move: ${sourceShortLabel} → ${best.shortLabel}.`,
    });
    checks.push({
      label: "Minimum holding period recovered",
      passed: days >= Math.ceil(best.breakEvenDays),
      detail:
        `${days}-day horizon vs ${days1(best.breakEvenDays)}-day break-even ` +
        `(fees + gas of ${money2(best.totalSwitchingCostSusdc)} sUSDC repaid by a ` +
        `${money2(best.dailyYieldAdvantageSusdc)} sUSDC/day yield edge).`,
    });
    checks.push({
      label: "Net gain clears hurdle",
      passed: best.expectedNetGainSusdc >= hurdle,
      detail:
        `Expected net gain ${signedMoney2(best.expectedNetGainSusdc)} sUSDC vs your ` +
        `${money2(hurdle)} sUSDC minimum.`,
    });
  }

  return {
    input: { ...input, holdingPeriodDays: days },
    sourceLabel,
    sourceShortLabel,
    sourceEffectiveApyBps: sourceApyBps,
    sourcePositionSusdc,
    walletIdleSusdc,
    verdict,
    verdictCode,
    reason,
    best,
     bestAlternative,
    candidates,
    checks,
    snapshotBlockNumber: snapshot.blockNumber,
    gasPriceWei: snapshot.gasPriceWei,
  };
}

/* --------------------------- candidate evaluator --------------------------- */

function evaluateCandidate(args: {
  vault: VaultLive;
  isSource: boolean;
  amount: number;
  days: number;
  sourceApyBps: number;
  sourceExitFeeBps: number;
  fromIdle: boolean;
  gasSusdc: number;
  gasWeiRaw: string;
  gasUnits: number;
  hurdle: number;
  apyBasis: "base" | "effective";
}): CandidateEvaluation {
  const { vault, isSource, amount, days, sourceApyBps, fromIdle } = args;
   const liveApyBps = args.apyBasis === "effective" ? vault.effectiveApyBps : vault.baseApyBps;
   // Staying does not allocate new capital, incur fees, or pay gas.
   const tvl = vault.totalAssetsSusdc;
   const postAllocationApyBps = isSource ? liveApyBps
     : tvl > 0 ? liveApyBps * tvl / (tvl + amount) : 0;
   const chosenApyBps = postAllocationApyBps;

  // Switching costs — Requirement 02. Moving FROM wallet_idle has no exit fee;
  // every other source uses its live on-chain exitFeeBps (T-Bill's is 0).
   const sourceExitFeeSusdc = fromIdle || isSource ? 0 : (amount * args.sourceExitFeeBps) / BPS_DEN;
   const targetEntryFeeSusdc = isSource ? 0 : ((amount - sourceExitFeeSusdc) * vault.entryFeeBps) / BPS_DEN;
  const totalSwitchingCostSusdc =
     sourceExitFeeSusdc + targetEntryFeeSusdc + (isSource ? 0 : args.gasSusdc);

  // Horizon-aware yield model on the post-fee principal.
  const postFeePrincipalSusdc = Math.max(0, amount - sourceExitFeeSusdc - targetEntryFeeSusdc);
   const sourceProjectedYieldSusdc = (amount * (sourceApyBps / BPS_DEN) * days) / DAYS_PER_YEAR;
  const targetGrossYieldSusdc =
    (postFeePrincipalSusdc * (chosenApyBps / BPS_DEN) * days) / DAYS_PER_YEAR;
  const grossYieldAdvantageSusdc = targetGrossYieldSusdc - sourceProjectedYieldSusdc;
  const expectedNetGainSusdc = grossYieldAdvantageSusdc - totalSwitchingCostSusdc;

   const dailyYieldAdvantageSusdc =
     (postFeePrincipalSusdc * chosenApyBps - amount * sourceApyBps) / BPS_DEN / DAYS_PER_YEAR;
  const breakEvenDays =
    dailyYieldAdvantageSusdc > 0
      ? totalSwitchingCostSusdc / dailyYieldAdvantageSusdc
      : Number.POSITIVE_INFINITY;

  return {
    venueId: vault.id,
    label: vault.protocolLabel,
    shortLabel: vault.shortLabel,
    contractName: vault.contractName,
    address: vault.address,
    explorerUrl: vault.explorerUrl,
    category: vault.category,
    paused: vault.paused,
    isSource,
    baseApyBps: vault.baseApyBps,
    effectiveApyBps: vault.effectiveApyBps,
    chosenApyBps,
    apyBasis: args.apyBasis,
    entryFeeBps: vault.entryFeeBps,
    exitFeeBps: vault.exitFeeBps,
    totalAssetsSusdc: vault.totalAssetsSusdc,
    sourceExitFeeSusdc,
    targetEntryFeeSusdc,
     estimatedGasCostSusdc: isSource ? 0 : args.gasSusdc,
     gasWeiRaw: isSource ? "0" : args.gasWeiRaw,
     gasUnits: isSource ? 0 : args.gasUnits,
    totalSwitchingCostSusdc,
    postFeePrincipalSusdc,
    sourceProjectedYieldSusdc,
    targetGrossYieldSusdc,
    grossYieldAdvantageSusdc,
    expectedNetGainSusdc,
    dailyYieldAdvantageSusdc,
    breakEvenDays,
    postAllocationApyBps,
     modeledDilutionBps: liveApyBps - postAllocationApyBps,
    meetsHoldingPeriod: days >= Math.ceil(breakEvenDays),
    meetsHurdle: expectedNetGainSusdc >= args.hurdle,
  };
}

/** Chain ID helper re-exported for the tx builder + UI badges. */
export { PHAROS_CHAIN_ID };
