/**
 * Unsigned calldata generation — Requirement 04.
 * Verifies viem encodeFunctionData output for redeem/approve/deposit (+ the
 * optional firewall step), EIP-155-style payload fields, full-exit sizing,
 * and that STAY_PUT verdicts produce ZERO fund-moving steps.
 */
import { describe, it, expect } from "vitest";
import {
  decodeFunctionData,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { deepLiquiditySnapshot as mockSnapshot } from "./helpers/mock-snapshot";
import { runOptimizer } from "@/lib/optimizer/yield-optimizer";
import {
  buildRebalanceTxBundle,
  sizeRedeem,
  computeAgentIntentDigest,
} from "@/lib/optimizer/tx-builder";
import type { OptimizerInput } from "@/lib/optimizer/types";

const VAULT_ABI = parseAbi([
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const FIREWALL_ABI = parseAbi([
  "function executeGuardedAllocation(address vault, uint256 amount, uint256 minSharesOut, bytes32 x402ReceiptHash, bytes32 agentIntentDigest) returns (uint256)",
]);

const WALLET = "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C";
const SUSDC = "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b";
const TBILL = "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78";
const CREDIT = "0x28080450b7be3963f55296ea9f2b45ad9af1b720";
const FIREWALL = "0x4bf82bc533befdafa0a0d2154842394b37a40ea1";

function input(overrides: Partial<OptimizerInput> = {}): OptimizerInput {
  return {
    sourceVenue: "wallet_idle",
    amountSusdc: 3000,
    holdingPeriodDays: 45,
    minNetGainSusdc: 2,
    apyBasis: "effective",
    ...overrides,
  };
}

describe("STAY_PUT produces zero fund-moving steps", () => {
  it("returns an empty step array for a STAY_PUT verdict", () => {
    const snap = mockSnapshot();
    const result = runOptimizer(
      input({ sourceVenue: "tbill", holdingPeriodDays: 14, amountSusdc: 5000 }),
      snap,
    );
    expect(result.verdict).toBe("STAY_PUT");
    const bundle = buildRebalanceTxBundle({
      result,
      snapshot: snap,
      walletAddress: WALLET,
    });
    expect(bundle.steps).toHaveLength(0);
    expect(bundle.netProceedsSusdc).toBe(0);
    expect(bundle.notes[0]).toContain("STAY_PUT");
  });

  it("returns an empty step array when the amount is zero", () => {
    const snap = mockSnapshot();
    const result = runOptimizer(input({ amountSusdc: 0 }), snap);
    const bundle = buildRebalanceTxBundle({ result, snapshot: snap, walletAddress: WALLET });
    expect(bundle.steps).toHaveLength(0);
  });
});

describe("REBALANCE bundles: idle wallet → credit (2-step route)", () => {
  const snap = mockSnapshot();
  const result = runOptimizer(input(), snap);
  const bundle = buildRebalanceTxBundle({ result, snapshot: snap, walletAddress: WALLET });

  it("recommends first and produces exactly approve + deposit", () => {
    expect(result.verdict).toBe("REBALANCE_RECOMMENDED");
    expect(bundle.steps.map((s) => s.signature)).toEqual([
      "approve(address,uint256)",
      "deposit(uint256,address)",
    ]);
  });

  it("encodes approve(SUSDC spender, exact amount) for the target vault", () => {
    const step = bundle.steps[0];
    expect(step.to.toLowerCase()).toBe(SUSDC.toLowerCase());
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: step.data });
    expect(decoded.functionName).toBe("approve");
    expect((decoded.args![0] as string).toLowerCase()).toBe(CREDIT.toLowerCase());
    // 3,000 sUSDC — no exit fee from idle, 12 bps entry fee taken by the vault
    expect(decoded.args![1]).toBe(300_000_0000n); // 3000.00 × 1e6
  });

  it("encodes deposit(assets, receiver=USER) with the user as receiver", () => {
    const step = bundle.steps[1];
    expect(step.to.toLowerCase()).toBe(CREDIT.toLowerCase());
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: step.data });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args![1]).toBe(WALLET);
    expect(decoded.args![0]).toBe(300_000_0000n);
  });

  it("every step is an unsigned EIP-155-style payload (value 0x0, chainId 688689)", () => {
    for (const step of bundle.steps) {
      expect(step.value).toBe("0x0");
      expect(step.chainId).toBe(688689);
      expect(step.data.startsWith("0x")).toBe(true);
      expect(step.gasLimitHex).toMatch(/^0x[1-9a-f]/);
      // selector = first 4 bytes of calldata
      expect(step.data.slice(0, 10)).toBe(step.selector);
    }
  });

  it("matches viem's computed function selectors", () => {
    expect(bundle.steps[0].selector).toBe(
      toFunctionSelector("approve(address,uint256)"),
    );
    expect(bundle.steps[1].selector).toBe(
      toFunctionSelector("deposit(uint256,address)"),
    );
  });
});

describe("REBALANCE bundles: harbor → credit (3-step redeem route)", () => {
  const snap = mockSnapshot();
  const result = runOptimizer(
    input({ sourceVenue: "harbor", amountSusdc: 4500, holdingPeriodDays: 90 }),
    snap,
  );
  const bundle = buildRebalanceTxBundle({ result, snapshot: snap, walletAddress: WALLET });

  it("emits redeem → approve → deposit in order", () => {
    expect(result.verdict).toBe("REBALANCE_RECOMMENDED");
    expect(bundle.steps.map((s) => s.signature)).toEqual([
      "redeem(uint256,address,address)",
      "approve(address,uint256)",
      "deposit(uint256,address)",
    ]);
  });

  it("sizes redeem shares from the pinned share price, net of the 5 bps exit fee", () => {
    const step = bundle.steps[0];
    expect(step.to.toLowerCase()).toBe(
      "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
    );
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: step.data });
    expect(decoded.functionName).toBe("redeem");
    const [shares, receiver, owner] = decoded.args! as [bigint, string, string];
    // Gross source capital; exit fees reduce proceeds, never gross up capital.
    const assets = 4_500_000000n; // 4500 × 1e6
    expect(shares).toBeGreaterThanOrEqual(assets);
    expect(shares).toBeLessThan(assets + 500_0000n); // within 5 sUSDC of it
    expect(receiver).toBe(WALLET);
    expect(owner).toBe(WALLET);
    // approve + deposit both carry the drift-trimmed proceeds (< 4,500)
    const approveAmt = decodeFunctionData({
      abi: VAULT_ABI,
      data: bundle.steps[1].data,
    }).args![1] as bigint;
    const depositAmt = decodeFunctionData({
      abi: VAULT_ABI,
      data: bundle.steps[2].data,
    }).args![0] as bigint;
    expect(approveAmt).toBe(depositAmt);
    expect(Number(approveAmt) / 1e6).toBeGreaterThan(4495);
    expect(Number(approveAmt) / 1e6).toBeLessThan(4500);
  });

  it("redeems the FULL live share balance when the amount covers the position", () => {
    const snap = mockSnapshot();
    const result = runOptimizer(
      input({ sourceVenue: "harbor", amountSusdc: 4999.999995, holdingPeriodDays: 90 }),
      snap,
    );
    const bundle = buildRebalanceTxBundle({ result, snapshot: snap, walletAddress: WALLET });
    const shares = decodeFunctionData({
      abi: VAULT_ABI,
      data: bundle.steps[0].data,
    }).args![0] as bigint;
    expect(shares).toBe(5_000_000000n); // exact live balanceOf — no dust stranded
  });
});

describe("optional SentinelPolicyFirewall guarded step", () => {
  const snap = mockSnapshot();
  const result = runOptimizer(input(), snap);

  it("encodes executeGuardedAllocation with vault, amount, minSharesOut and digest", () => {
    const bundle = buildRebalanceTxBundle({
      result,
      snapshot: snap,
      walletAddress: WALLET,
      includeFirewallStep: true,
      x402ReceiptHash: `0x${"1".repeat(64)}`,
    });
    const fw = bundle.steps.find(
      (s) => s.signature === "executeGuardedAllocation(address,uint256,uint256,bytes32,bytes32)",
    );
    expect(fw).toBeDefined();
    expect(fw!.to.toLowerCase()).toBe(FIREWALL.toLowerCase());
    const decoded = decodeFunctionData({ abi: FIREWALL_ABI, data: fw!.data });
    expect(decoded.functionName).toBe("executeGuardedAllocation");
    const [vault, amount, minSharesOut, receipt, digest] = decoded.args! as [
      string,
      bigint,
      bigint,
      `0x${string}`,
      `0x${string}`,
    ];
    expect(vault.toLowerCase()).toBe(CREDIT.toLowerCase());
    expect(amount).toBe(300_000_0000n);
    // slippage-bounded share floor (30 bps under the pinned estimate)
    expect(minSharesOut).toBeGreaterThan(0n);
    expect(minSharesOut).toBeLessThan(amount);
    // keyless deterministic digest + zero receipt placeholder
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt).toBe(`0x${"1".repeat(64)}`);
    expect(bundle.steps.map((s) => s.signature)).toEqual(["approve(address,uint256)", "executeGuardedAllocation(address,uint256,uint256,bytes32,bytes32)"]);
    expect(String(decodeFunctionData({ abi: VAULT_ABI, data: bundle.steps[0].data }).args![0]).toLowerCase()).toBe(FIREWALL);
  });

  it("derives a deterministic, keyless agent intent digest", () => {
    const a = computeAgentIntentDigest({
      sourceVenueId: "wallet_idle",
      targetVenueId: "credit",
      amountRaw: 300_000_0000n,
      blockNumber: 4_242_424,
    });
    const b = computeAgentIntentDigest({
      sourceVenueId: "wallet_idle",
      targetVenueId: "credit",
      amountRaw: 300_000_0000n,
      blockNumber: 4_242_424,
    });
    const c = computeAgentIntentDigest({
      sourceVenueId: "wallet_idle",
      targetVenueId: "credit",
      amountRaw: 300_000_0001n,
      blockNumber: 4_242_424,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("redeem share sizing math", () => {
  it("floors shares and computes fee-net proceeds exactly", () => {
    const sizing = sizeRedeem({
      amountRaw: 5_000_000000n,
      exitFeeBps: 5n,
      totalAssetsRaw: 5_000_000070n,
      totalSupplyRaw: 5_000_000000n,
      userSharesRaw: 5_000_000000n,
    });
    // price = 1.000000014 (raw 1000000); net per share = 0.99995 × price
    expect(sizing.fullExit).toBe(true);
    expect(sizing.sharesRaw).toBe(5_000_000000n);
    // proceeds = 5000 × (1 − 5 bps) = 4997.50
    expect(Number(sizing.proceedsRaw) / 1e6).toBeCloseTo(4996.5, 2);
  });

  it("handles zero-supply vaults defensively", () => {
    const sizing = sizeRedeem({
      amountRaw: 1_000000n,
      exitFeeBps: 0n,
      totalAssetsRaw: 0n,
      totalSupplyRaw: 0n,
      userSharesRaw: 0n,
    });
    expect(sizing.sharesRaw).toBe(0n);
  });
});
