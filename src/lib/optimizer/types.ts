/**
 * Shared domain types for the Pharos Apex horizon-aware yield optimizer.
 *
 * Two layers:
 *  1. Snapshot types — produced by the block-pinned on-chain reader
 *     (`src/lib/onchain/snapshot-reader.ts`), JSON-safe (all bigint raw
 *     values are stringified).
 *  2. Optimizer types — produced by the pure engine
 *     (`src/lib/optimizer/yield-optimizer.ts`) from a snapshot + user input.
 */
import type { SourceVenueId, VenueId } from "@/lib/contracts";

/* ------------------------------ Provenance -------------------------------- */

/** One auditable on-chain figure: value ← contract.function @ block. */
export interface ProvenanceEntry {
  /** Machine key, e.g. "credit.effectiveApyBps" or "rpc.gasPrice". */
  key: string;
  /** Human figure, e.g. "983 bps (9.83%)". */
  value: string;
  contractName: string;
  contractAddress: string;
  /** ABI function or raw RPC method, e.g. "effectiveApyBps()" / "eth_gasPrice". */
  functionCalled: string;
  blockNumber: number;
  explorerUrl: string;
}

/* ------------------------------- Snapshot --------------------------------- */

export interface WalletLive {
  address: string;
  /** sUSDC balance, human units (6 decimals applied). */
  susdc: number;
  susdcRaw: string;
  /** Native PHRS balance, human units (18 decimals applied). */
  phrs: number;
  phrsRaw: string;
}

export interface VaultLive {
  id: VenueId;
  contractName: string;
  protocolLabel: string;
  shortLabel: string;
  category: "RWA" | "DeFi";
  address: string;
  explorerUrl: string;
  blockNumber: number;
  /* Live figures in human units */
  totalAssetsSusdc: number;
  totalSupplyShares: number;
  /** Live share price: assets per share (convertToAssets basis). */
  sharePriceSusdc: number;
  baseApyBps: number;
  /** Diluted effective APY — the honest yield used by the optimizer. */
  effectiveApyBps: number;
  entryFeeBps: number;
  exitFeeBps: number;
  utilizationBps: number | null;
  kyaCollateralRatioBps: number | null;
  paused: boolean;
  /** The inspected wallet's position in this vault. */
  userShares: number;
  userSharesRaw: string;
  userAssetsSusdc: number;
  /* Raw strings kept for exact tx-sizing math + provenance. */
  totalAssetsRaw: string;
  totalSupplyRaw: string;
}

/** A source that could not be read at the pinned block — reported, never guessed. */
export interface UnreadableVenue {
  /** Venue id, or "wallet" / "rpc" for non-vault sources. */
  id: string;
  label: string;
  contractAddress: string;
  blockNumberAttempted: number;
  reason: string;
}

export interface OptimizerSnapshot {
  chainId: number;
  chainName: string;
  rpcEndpoint: string;
  explorerUrl: string;
  /** Single pinned block height every figure was read at. */
  blockNumber: number;
  readAtIso: string;
  /** True when served from the last-known-good cache after RPC throttling. */
  fromCache: boolean;
  /** Live gas price from eth_gasPrice, raw wei as a decimal string. */
  gasPriceWei: string;
   gasPriceGwei: number;
   /** Gas RPC failed; zero raw quote is a sentinel, not free gas. */
   gasPriceUnavailable?: boolean;
  wallet: WalletLive | null;
  /** Readable venues only — unreadable ones are listed separately. */
  vaults: VaultLive[];
  unreadableVenues: UnreadableVenue[];
  provenance: ProvenanceEntry[];
  allVenueReadsFailed: boolean;
}

/* ------------------------------- Optimizer -------------------------------- */

export type Verdict = "REBALANCE_RECOMMENDED" | "STAY_PUT";

/** Exact stay-put reason codes from the bounty rubric. */
export type StayPutReason =
  | "ALREADY_IN_OPTIMAL_VAULT"
  | "HOLDING_PERIOD_TOO_SHORT"
  | "NET_GAIN_BELOW_HURDLE";

export interface OptimizerInput {
  /** Where the capital sits today (3 vaults or idle wallet sUSDC). */
  sourceVenue: SourceVenueId;
  /** Position size in sUSDC. */
  amountSusdc: number;
  /** Intended holding period, 1–365 days. */
  holdingPeriodDays: number;
  /** Minimum expected net gain (sUSDC) before a move is worth it. */
  minNetGainSusdc: number;
  /**
   * Which live on-chain APY drives the comparison:
    *  - "base":      exploratory headline baseApyBps().
    *  - "effective": the utilization-diluted effectiveApyBps() (default)
   *                 (credit: base × utilization/10⁴ — conservative).
   */
   apyBasis: "base" | "effective";
   executionRoute?: "standard" | "guarded";
}

/** Full net-yield evaluation of ONE candidate vault as a move target. */
export interface CandidateEvaluation {
  venueId: VenueId;
  label: string;
  shortLabel: string;
  contractName: string;
  address: string;
  explorerUrl: string;
  category: "RWA" | "DeFi";
  paused: boolean;
  isSource: boolean;

  /* Live venue parameters (bps) */
  baseApyBps: number;
  effectiveApyBps: number;
   /** Chosen live basis after modeled post-allocation TVL dilution. */
  chosenApyBps: number;
  apyBasis: "base" | "effective";
  entryFeeBps: number;
  exitFeeBps: number;
  totalAssetsSusdc: number;

  /* ---- Switching-cost model (sUSDC) — Requirement 02 ---- */
  /** (amount × sourceExitFeeBps) / 10000 — 0 from wallet_idle. */
  sourceExitFeeSusdc: number;
  /** ((amount − sourceExitFee) × targetEntryFeeBps) / 10000. */
  targetEntryFeeSusdc: number;
  /** Live eth_gasPrice × route gas units → sUSDC, floored at $0.04. */
  estimatedGasCostSusdc: number;
  /** Raw gas quote in PHRS wei (before the sUSDC floor), for transparency. */
  gasWeiRaw: string;
  /** Route gas units actually used for the quote. */
  gasUnits: number;
  /** exit + entry + gas. */
  totalSwitchingCostSusdc: number;

  /* ---- Horizon-aware yield model (sUSDC) ---- */
  /** Principal actually working after fees: amount − exit − entry. */
  postFeePrincipalSusdc: number;
  /** Yield over the horizon if the capital stays in the source venue. */
  sourceProjectedYieldSusdc: number;
  /** Gross yield over the horizon in the candidate (post-fee principal). */
  targetGrossYieldSusdc: number;
  /** targetGross − sourceProjected. */
  grossYieldAdvantageSusdc: number;
  /** grossYieldAdvantage − totalSwitchingCost. The headline number. */
  expectedNetGainSusdc: number;
   /** (postFeePrincipal × targetAPY − fullAmount × sourceAPY) / 365. */
  dailyYieldAdvantageSusdc: number;
  /** switchingCost / dailyAdvantage (∞ when ΔAPY ≤ 0). */
  breakEvenDays: number;

   /* ---- Post-allocation TVL dilution used in recommendation math ---- */
  /** Modeled effective APY after `amount` joins the vault TVL. */
  postAllocationApyBps: number;
   /** Selected live basis − postAllocationApyBps (0 = no dilution). */
  modeledDilutionBps: number;

  /* ---- Rubric condition checks (against the best candidate) ---- */
  /** holdingPeriodDays ≥ ⌈breakEvenDays⌉ — the minimum-holding-period test. */
  meetsHoldingPeriod: boolean;
  /** expectedNetGain ≥ minNetGainSusdc hurdle. */
  meetsHurdle: boolean;
}

export interface VerdictCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface OptimizerResult {
  input: OptimizerInput;
  /** Label + live APY of the source venue ("Wallet idle sUSDC", 0%…). */
  sourceLabel: string;
  sourceShortLabel: string;
  sourceEffectiveApyBps: number;
  /** Live on-chain position behind the source (null for wallet_idle). */
  sourcePositionSusdc: number | null;
  walletIdleSusdc: number | null;

  verdict: Verdict;
  /** Null only in degenerate cases (no readable/executable target). */
  verdictCode: StayPutReason | null;
  /** Crystal-clear human + quantitative narrative for the verdict. */
  reason: string;

  /** Highest-net candidate (may be the source venue itself). */
  best: CandidateEvaluation | null;
  /** Highest-net candidate that is NOT the source venue. */
  bestAlternative: CandidateEvaluation | null;
  /** All readable candidates sorted by expectedNetGain desc. */
  candidates: CandidateEvaluation[];

  checks: VerdictCheck[];
  snapshotBlockNumber: number;
  gasPriceWei: string;
}

/* ------------------------------ Tx bundle --------------------------------- */

/** A single unsigned EIP-155-style transaction for the user's wallet. */
export interface UnsignedTxStep {
  index: number;
  label: string;
  description: string;
  to: `0x${string}`;
  /** Always "0x0" — no native value moves in a rebalance. */
  value: "0x0";
  data: `0x${string}`;
  /** 4-byte selector, surfaced for quick manual verification. */
  selector: `0x${string}`;
  chainId: number;
  gasLimitHex: string;
  gasUnits: number;
  /** Function signature encoded, e.g. "redeem(uint256,address,address)". */
  signature: string;
  /** Human-decoded arguments for review (already checksummed where relevant). */
  decodedArgs: Array<{ name: string; value: string }>;
}

export interface TxBundle {
  route: "standard" | "guarded";
  steps: UnsignedTxStep[];
  /** Net sUSDC amount expected to land in the target vault. */
  netProceedsSusdc: number;
  /** Summary lines rendered above the sign button. */
  notes: string[];
}

/** What the UI needs to render the "Sign with Wallet (Non-Custodial)" modal. */
export interface SignRequest {
  step: UnsignedTxStep;
}
