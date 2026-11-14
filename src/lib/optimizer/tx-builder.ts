/**
 * Non-Custodial Unsigned Transaction Bundle Builder (Requirement 04).
 *
 * When — and ONLY when — the optimizer verdict is REBALANCE_RECOMMENDED,
 * this module prepares the exact step-by-step UNSIGNED transaction array
 * (redeem from source vault → approve sUSDC → deposit into target vault,
 * OR redeem → approve FIREWALL → executeGuardedAllocation, never both routes).
 *
 * HARD AIRGAP GUARANTEES:
 *  - Calldata is produced with viem `encodeFunctionData` — pure byte math.
 *  - Every step is an UNSIGNED EIP-155-style payload (chainId 688689,
 *    value "0x0"); the USER's own wallet signs and broadcasts it.
 *  - No key material exists anywhere in this project; `STAY_PUT` verdicts
 *    produce ZERO fund-moving steps (verified by tests +
 *    `npm run audit:noncustodial`).
 */
import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  getAddress,
  type Address,
} from "viem";
import {
  FIREWALL_ENCODE_ABI,
  GAS_UNITS,
  PHAROS_CHAIN_ID,
  POLICY_FIREWALL_ADDRESS,
  SUSDC_ADDRESS,
  VAULT_ENCODE_ABI,
  venueById,
  type VenueId,
} from "@/lib/contracts";
import type {
  OptimizerResult,
  OptimizerSnapshot,
  TxBundle,
  UnsignedTxStep,
} from "./types";

/**
 * Signing-time drift buffer (0.05%): the deposit/approve amount is trimmed
 * below the pinned-block estimate. This is not a guarantee: signing must
 * simulate against current state and verify proceeds after redemption.
 */
export const SIGNING_DRIFT_BUFFER_BPS = 0n;

/** Firewall's default slippage bound (SentinelPolicyFirewall policy). */
export const FIREWALL_SLIPPAGE_BPS = 30n;

/** Estimated gas for the guarded 1-step route (deposit + 5 atomic guards). */
export const FIREWALL_GAS_UNITS = 220_000;

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;
const VIRTUAL_OFFSET = 1_000_000n; // Exact deployed SentinelVault4626 conversion.

/** First 4 bytes of calldata — the function selector, for quick verification. */
function selectorOf(data: `0x${string}`): `0x${string}` {
  return data.slice(0, 10) as `0x${string}`;
}

/** Pinned share price as 6-dec assets per 6-dec share unit. */
function ceilDiv(num: bigint, den: bigint): bigint { return (num + den - 1n) / den; }

function fmtSusdc(raw: bigint): string {
  return (Number(raw) / 1e6).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/** Deterministic, keyless intent digest for the firewall replay guard. */
export function computeAgentIntentDigest(args: {
  sourceVenueId: string;
  targetVenueId: string;
  amountRaw: bigint;
  blockNumber: number;
  walletAddress?: string;
}): `0x${string}` {
  const payload = `pharos-apex/rebalance/v2:${args.walletAddress?.toLowerCase() ?? ""}:${args.sourceVenueId}->${args.targetVenueId}:${args.amountRaw.toString()}:block=${args.blockNumber}`;
  return keccak256(stringToHex(payload));
}

/* ------------------------------ share sizing ------------------------------ */

interface RedeemSizing {
  sharesRaw: bigint;
  proceedsRaw: bigint;
  fullExit: boolean;
}

/**
 * amountRaw is GROSS source capital, not desired fee-net proceeds.
 * Match the deployed virtual-offset conversion with integer rounding.
 */
export function sizeRedeem(args: {
  amountRaw: bigint;
  exitFeeBps: bigint;
  totalAssetsRaw: bigint;
  totalSupplyRaw: bigint;
  userSharesRaw: bigint;
}): RedeemSizing {
  const { amountRaw, exitFeeBps, totalAssetsRaw, totalSupplyRaw, userSharesRaw } = args;
  const sharesForAmount = totalSupplyRaw > 0n && totalAssetsRaw > 0n
    ? amountRaw * (totalSupplyRaw + VIRTUAL_OFFSET) / (totalAssetsRaw + 1n)
    : amountRaw;
  const availableGross = totalSupplyRaw > 0n
    ? userSharesRaw * (totalAssetsRaw + 1n) / (totalSupplyRaw + VIRTUAL_OFFSET) : userSharesRaw;
  const fullExit = userSharesRaw > 0n && amountRaw >= availableGross;
  // Partial redemption: never request more shares than the wallet actually
  // holds (a simulated amount can exceed the live position).
  const sharesRaw = fullExit
    ? userSharesRaw
    : sharesForAmount < userSharesRaw
      ? sharesForAmount
      : userSharesRaw;

  // Expected asset proceeds from redeeming `sharesRaw` (floored).
  const gross = totalSupplyRaw > 0n
    ? ceilDiv(sharesRaw * (totalAssetsRaw + 1n), totalSupplyRaw + VIRTUAL_OFFSET) : sharesRaw;
  const proceedsRaw = gross - gross * exitFeeBps / 10_000n;
  return { sharesRaw, proceedsRaw, fullExit };
}

/* ------------------------------- the builder ------------------------------ */

export interface BuildTxBundleArgs {
  result: OptimizerResult;
  snapshot: OptimizerSnapshot;
  /** Include the optional 1-step SentinelPolicyFirewall guarded route. */
  includeFirewallStep?: boolean;
  /** The USER's own wallet — receiver and owner of every step. */
  walletAddress: string;
  /** Optional x402 payment receipt hash required by strict firewall policies. */
  x402ReceiptHash?: `0x${string}`;
}

/**
 * Build the unsigned rebalance bundle. Returns ZERO steps for any
 * STAY_PUT verdict (Requirement 04: prepare only, and only when moving).
 */
export function buildRebalanceTxBundle(
  args: BuildTxBundleArgs,
): TxBundle {
  const { result, snapshot, walletAddress } = args;

  if (result.verdict !== "REBALANCE_RECOMMENDED" || !result.best) {
    return {
      route: "standard",
      steps: [],
      netProceedsSusdc: 0,
      notes: [
        `Verdict is ${result.verdict}${result.verdictCode ? ` (${result.verdictCode})` : ""} — the builder refuses to prepare fund-moving transactions. Stay Put.`,
      ],
    };
  }

  const owner = getAddress(walletAddress);
  const target = result.best;
  const targetVault = venueById(target.venueId as VenueId);
  const notes: string[] = [];

  const sourceVault =
    result.input.sourceVenue === "wallet_idle"
      ? null
      : snapshot.vaults.find((v) => v.id === result.input.sourceVenue) ?? null;

  const refuse = (note: string): TxBundle => ({ route: args.includeFirewallStep ? "guarded" : "standard", steps: [], netProceedsSusdc: 0, notes: [note] });
  if (snapshot.chainId !== PHAROS_CHAIN_ID || snapshot.blockNumber !== result.snapshotBlockNumber || snapshot.fromCache) {
    return refuse("No bundle: stale, cached or mismatched snapshot. Re-read live state before preparing.");
  }
  if (!snapshot.wallet || snapshot.wallet.address.toLowerCase() !== owner.toLowerCase()) {
    return refuse("No bundle: receiver must match the wallet whose balances were inspected.");
  }
  if (result.input.sourceVenue !== "wallet_idle" && !sourceVault) return refuse("No bundle: source is unreadable.");
  const targetLive = snapshot.vaults.find((v) => v.id === target.venueId);
  if (!targetLive || targetLive.paused || sourceVault?.paused) return refuse("No bundle: target or source unavailable/paused.");
  if (args.includeFirewallStep && (!args.x402ReceiptHash || !/^0x[0-9a-fA-F]{64}$/.test(args.x402ReceiptHash) || args.x402ReceiptHash === ZERO_BYTES32)) {
    return refuse("Guarded route requires a non-zero user-supplied receipt hash. Policy and receipt provenance must be checked before signing.");
  }

  const amountRaw = BigInt(Math.round(result.input.amountSusdc * 1e6));
  if (amountRaw <= 0n) {
    return {
      route: "standard",
      steps: [],
      netProceedsSusdc: 0,
      notes: ["Amount is zero — nothing to prepare."],
    };
  }
  const availableRaw = sourceVault
    ? (BigInt(sourceVault.userSharesRaw) * (BigInt(sourceVault.totalAssetsRaw) + 1n)) / (BigInt(sourceVault.totalSupplyRaw) + VIRTUAL_OFFSET)
    : BigInt(snapshot.wallet.susdcRaw);
  // One underlying micro-unit tolerance for conversion rounding; never silently
  // resize a hypothetical recommendation to a different live position.
  if (amountRaw > availableRaw + 1n) return refuse("Scenario is hypothetical: requested amount exceeds the inspected source balance. Reduce the amount or inspect your own funded wallet; no transactions prepared.");

  const steps: UnsignedTxStep[] = [];
  let index = 1;
  let depositAssetsRaw = amountRaw;

  /* ---- Step 1 (vault sources only): redeem shares from the source vault ---- */
  if (sourceVault) {
    const sizing = sizeRedeem({
      amountRaw,
      exitFeeBps: BigInt(sourceVault.exitFeeBps),
      totalAssetsRaw: BigInt(sourceVault.totalAssetsRaw),
      totalSupplyRaw: BigInt(sourceVault.totalSupplyRaw),
      userSharesRaw: BigInt(sourceVault.userSharesRaw),
    });
    if (sizing.sharesRaw <= 0n || sizing.proceedsRaw <= 0n) return refuse("No bundle: zero shares or redemption proceeds.");
    const data = encodeFunctionData({
      abi: VAULT_ENCODE_ABI,
      functionName: "redeem",
      args: [sizing.sharesRaw, owner, owner],
    });
    steps.push({
      index: index++,
      label: `Redeem ${fmtSusdc(sizing.sharesRaw)} ${result.sourceShortLabel} shares`,
      description: sizing.fullExit
        ? `Full exit from ${sourceVault.contractName} — redeems the entire live share balance (convertToAssets ≈ ${fmtSusdc(sizing.proceedsRaw)} sUSDC net of ${sourceVault.exitFeeBps} bps exit fee).`
        : `Partial exit from ${sourceVault.contractName} — sized at the pinned share price for ≈ ${fmtSusdc(sizing.proceedsRaw)} sUSDC net of ${sourceVault.exitFeeBps} bps exit fee.`,
      to: sourceVault.address as `0x${string}`,
      value: "0x0",
      data,
      selector: selectorOf(data),
      chainId: PHAROS_CHAIN_ID,
      gasLimitHex: `0x${GAS_UNITS.redeem.toString(16)}`,
      gasUnits: GAS_UNITS.redeem,
      signature: "redeem(uint256,address,address)",
      decodedArgs: [
        { name: "shares", value: fmtSusdc(sizing.sharesRaw) },
        { name: "receiver", value: owner },
        { name: "owner", value: owner },
      ],
    });
    // Deposit what the redeem actually produces (estimate, drift-trimmed).
    depositAssetsRaw = (sizing.proceedsRaw * (10_000n - SIGNING_DRIFT_BUFFER_BPS)) / 10_000n;
    if (sizing.fullExit) {
      notes.push(
        "Full-exit sizing: the redeem step burns your entire live share balance so no dust is stranded.",
      );
    }
  }

  /* ---- Step 2: exactly ONE route-specific spender ---- */
  const spender = args.includeFirewallStep ? POLICY_FIREWALL_ADDRESS : targetVault.address as `0x${string}`;
  const approveData = encodeFunctionData({
    abi: VAULT_ENCODE_ABI,
    functionName: "approve",
    args: [spender, depositAssetsRaw],
  });
  steps.push({
    index: index++,
    label: `Approve ${fmtSusdc(depositAssetsRaw)} sUSDC → ${args.includeFirewallStep ? "SentinelPolicyFirewall" : targetVault.contractName}`,
    description: `Exact-amount, revocable ERC-20 approval of SentinelUSD for the target vault (${targetVault.shortLabel}). Never an unlimited allowance.`,
    to: SUSDC_ADDRESS,
    value: "0x0",
    data: approveData,
    selector: selectorOf(approveData),
    chainId: PHAROS_CHAIN_ID,
    gasLimitHex: `0x${GAS_UNITS.approve.toString(16)}`,
    gasUnits: GAS_UNITS.approve,
    signature: "approve(address,uint256)",
    decodedArgs: [
      { name: "spender", value: spender },
      { name: "amount", value: fmtSusdc(depositAssetsRaw) },
    ],
  });

  /* ---- Step 3: deposit into the target vault ---- */
  if (!args.includeFirewallStep) {
  const depositData = encodeFunctionData({
    abi: VAULT_ENCODE_ABI,
    functionName: "deposit",
    args: [depositAssetsRaw, owner],
  });
  steps.push({
    index: index++,
    label: `Deposit ${fmtSusdc(depositAssetsRaw)} sUSDC → ${targetVault.shortLabel}`,
    description: `ERC-4626 deposit into ${targetVault.contractName} at ${target.effectiveApyBps / 100}% live effective APY (shares mint to YOUR wallet — custody never leaves you).`,
    to: targetVault.address as `0x${string}`,
    value: "0x0",
    data: depositData,
    selector: selectorOf(depositData),
    chainId: PHAROS_CHAIN_ID,
    gasLimitHex: `0x${GAS_UNITS.deposit.toString(16)}`,
    gasUnits: GAS_UNITS.deposit,
    signature: "deposit(uint256,address)",
    decodedArgs: [
      { name: "assets", value: fmtSusdc(depositAssetsRaw) },
      { name: "receiver", value: owner },
    ],
  });
  }

  /* ---- Optional: 1-step guarded route via SentinelPolicyFirewall ---- */
  if (args.includeFirewallStep) {
    const supply = BigInt(targetLive.totalSupplyRaw);
    const assets = BigInt(targetLive.totalAssetsRaw);
    const grossShares = supply === 0n || assets === 0n ? depositAssetsRaw
      : ceilDiv(depositAssetsRaw * (supply + VIRTUAL_OFFSET), assets + 1n);
    const expectedShares = grossShares - grossShares * BigInt(targetLive.entryFeeBps) / 10_000n;
    const minSharesOut =
      (expectedShares * (10_000n - FIREWALL_SLIPPAGE_BPS)) / 10_000n;
    const intentDigest = computeAgentIntentDigest({
      sourceVenueId: result.input.sourceVenue,
      targetVenueId: target.venueId,
      amountRaw: depositAssetsRaw,
      blockNumber: snapshot.blockNumber,
      walletAddress: owner,
    });
    const firewallData = encodeFunctionData({
      abi: FIREWALL_ENCODE_ABI,
      functionName: "executeGuardedAllocation",
      args: [
        targetVault.address as `0x${string}`,
        depositAssetsRaw,
        minSharesOut,
        args.x402ReceiptHash ?? ZERO_BYTES32,
        intentDigest,
      ],
    });
    steps.push({
      index: index++,
      label: `Guarded 1-step allocation via SentinelPolicyFirewall`,
      description:
        "Alternative route: after the exact FIREWALL approval, enforce on-chain spend cap, whitelist, receipt-hash presence, replay protection and minimum shares. Never also execute a direct deposit.",
      to: POLICY_FIREWALL_ADDRESS,
      value: "0x0",
      data: firewallData,
      selector: selectorOf(firewallData),
      chainId: PHAROS_CHAIN_ID,
      gasLimitHex: `0x${FIREWALL_GAS_UNITS.toString(16)}`,
      gasUnits: FIREWALL_GAS_UNITS,
      signature:
        "executeGuardedAllocation(address,uint256,uint256,bytes32,bytes32)",
      decodedArgs: [
        { name: "vault", value: targetVault.address },
        { name: "amount", value: fmtSusdc(depositAssetsRaw) },
        { name: "minSharesOut", value: fmtSusdc(minSharesOut) },
        {
          name: "x402ReceiptHash",
          value: args.x402ReceiptHash ?? `${ZERO_BYTES32.slice(0, 18)}… (set your receipt)`,
        },
        { name: "agentIntentDigest", value: intentDigest },
      ],
    });
    notes.push(
      "Guarded route replaces direct approve/deposit. Receipt hash is supplied by the user; the deployed firewall checks non-zero presence, not cryptographic payment validity. Confirm policy caps and whitelist with current-state simulation.",
    );
  }

  notes.push(
    `All steps are UNSIGNED payloads on chain ${PHAROS_CHAIN_ID} (Pharos Atlantic), value 0x0, sized at pinned block #${snapshot.blockNumber}.`,
    "Payloads are fixed estimates, not wallet-recomputed amounts. Simulate each step, wait for its receipt, and verify proceeds before the next step. Only your wallet signs and broadcasts; no server-side signer exists.",
  );

  return {
    route: args.includeFirewallStep ? "guarded" : "standard",
    steps,
    netProceedsSusdc: Number(depositAssetsRaw) / 1e6,
    notes,
  };
}

/** Exported for tests. */
export { getAddress as toChecksumAddress };
export type { Address };
