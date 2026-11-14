/**
 * Block-pinned snapshot reader — Requirement 01 live-data guarantees:
 * every read lands on ONE pinned block height, batched via Multicall3, and
 * the last-known-good cache serves stale-but-honest data when the RPC dies.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readOptimizerSnapshot,
  resetLastKnownGoodCache,
  type ReadClient,
} from "@/lib/onchain/snapshot-reader";
import { DEFAULT_WALLET } from "@/lib/contracts";

const WALLET = DEFAULT_WALLET;

function fakeClient(opts: { failAfter?: number } = {}): ReadClient {
  let callCount = 0;
  const pinnedBlocks = new Set<string>();
  const valueFor = (fn: string): unknown => {
    switch (fn) {
      case "balanceOf":
        return 1_000_000000n; // 1000.00 shares / sUSDC
      case "totalAssets":
        return 1_000_000000n;
      case "totalSupply":
        return 1_000_000000n;
      case "baseApyBps":
        return 815n;
      case "effectiveApyBps":
        return 815n;
      case "entryFeeBps":
        return 12n;
      case "exitFeeBps":
        return 5n;
      case "paused":
        return false;
      case "asset":
        return "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b";
      case "symbol":
        return "MOCK";
      case "convertToAssets":
        return 999_999999n;
      case "kyaCollateralRatioBps":
        return 10280n;
      case "utilizationBps":
        return 4200n;
      case "decimals":
        return 6;
      default:
        return 0n;
    }
  };
  return {
    getBlockNumber: async () => {
      callCount++;
      if (opts.failAfter !== undefined && callCount > opts.failAfter) {
        throw new Error("simulated RPC outage");
      }
      return 4_242_424n;
    },
     getBalance: async (args) => { expect(args.blockNumber).toBe(4_242_424n); return 40_321_156_000_000_000n; },
    getGasPrice: async () => 10_000_000_000n,
    readContract: async (args) => valueFor(args.functionName),
     multicall: async (args) => {
       expect(args.blockNumber).toBe(4_242_424n);
      if (opts.failAfter !== undefined) throw new Error("simulated RPC outage");
      pinnedBlocks.add(args.blockNumber?.toString() ?? "latest");
      return args.contracts.map((c) => valueFor(c.functionName));
    },
  };
}

beforeEach(() => resetLastKnownGoodCache());

describe("block-pinned reads", () => {
  it("reads wallet + all 3 vaults at ONE pinned block via multicall", async () => {
    const snap = await readOptimizerSnapshot({
      address: WALLET,
      client: fakeClient(),
      retryBackoffMs: 0,
      requestSpacingMs: 0,
    });
    expect(snap.blockNumber).toBe(4_242_424);
    expect(snap.vaults).toHaveLength(3);
    expect(snap.wallet?.susdc).toBeCloseTo(1000, 6);
    expect(snap.wallet?.phrs).toBeCloseTo(0.040321156, 9);
    for (const v of snap.vaults) {
      expect(v.blockNumber).toBe(4_242_424);
      expect(v.userAssetsSusdc).toBeCloseTo(999.999999, 4);
    }
    // provenance covers every figure with the pinned block
    expect(snap.provenance.length).toBeGreaterThanOrEqual(3 * 9);
    for (const p of snap.provenance) {
      expect(p.blockNumber).toBe(4_242_424);
    }
     expect(snap.gasPriceWei).toBe("10000000000");
     expect(snap.vaults[0].totalSupplyShares).toBe(1000);
     const gas = snap.provenance.find((p) => p.key === "rpc.gasPrice")!;
     expect(gas.functionCalled).toContain("not block-pinned");
     expect(gas.explorerUrl).toBe("https://atlantic.pharosscan.xyz/block/4242424");
  });

  it("records credit utilization and tbill KYA extras", async () => {
    const snap = await readOptimizerSnapshot({
      address: WALLET,
      client: fakeClient(),
      retryBackoffMs: 0,
      requestSpacingMs: 0,
    });
    const credit = snap.vaults.find((v) => v.id === "credit")!;
    const tbill = snap.vaults.find((v) => v.id === "tbill")!;
    expect(credit.utilizationBps).toBe(4200);
    expect(credit.entryFeeBps).toBe(12);
    expect(tbill.kyaCollateralRatioBps).toBe(10280);
  });
});

describe("fault isolation + last-known-good cache", () => {
   it("marks unavailable gas instead of implying it is free", async () => {
     const client = fakeClient(); client.getGasPrice = async () => { throw new Error("gas failed"); };
     const snapshot = await readOptimizerSnapshot({ address: WALLET, client, retryBackoffMs: 0, requestSpacingMs: 0 });
     expect(snapshot.gasPriceUnavailable).toBe(true);
     expect(snapshot.unreadableVenues.some((v) => v.label === "Gas quote unavailable")).toBe(true);
   });
  it("reports an unreadable venue without poisoning the others", async () => {
    const client = fakeClient();
    const originalMulticall = client.multicall!;
    client.multicall = async (args) => {
      // fail any batch that touches the harbor venue's wave-1 calls
      const touchesHarbor = args.contracts.some(
        (c) => c.address === "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
      );
      if (touchesHarbor) throw new Error("harbor read throttled");
      return originalMulticall(args);
    };
    const snap = await readOptimizerSnapshot({
      address: WALLET,
      client,
      retryBackoffMs: 0,
      requestSpacingMs: 0,
    });
    expect(snap.vaults.map((v) => v.id)).toEqual(["tbill", "credit"]);
    expect(snap.unreadableVenues).toHaveLength(1);
    expect(snap.unreadableVenues[0].id).toBe("harbor");
    expect(snap.allVenueReadsFailed).toBe(false);
  });

  it("serves the last-known-good snapshot (flagged fromCache) when the RPC dies", async () => {
    const good = await readOptimizerSnapshot({
      address: WALLET,
      client: fakeClient(),
      retryBackoffMs: 0,
      requestSpacingMs: 0,
    });
    expect(good.fromCache).toBe(false);

    const stale = await readOptimizerSnapshot({
      address: WALLET,
      client: fakeClient({ failAfter: 0 }),
      retryBackoffMs: 0,
      requestSpacingMs: 0,
    });
    expect(stale.fromCache).toBe(true);
    expect(stale.blockNumber).toBe(good.blockNumber);
    expect(stale.unreadableVenues.some((u) => u.id === "rpc")).toBe(true);
  });

  it("throws honestly when there is no cache and the RPC is down", async () => {
    await expect(
      readOptimizerSnapshot({
        address: WALLET,
        client: fakeClient({ failAfter: 0 }),
        retryBackoffMs: 0,
        requestSpacingMs: 0,
      }),
    ).rejects.toThrow(/no last-known-good cache exists/);
  });

  it("rejects malformed wallet addresses", async () => {
    await expect(
      readOptimizerSnapshot({ address: "not-an-address", client: fakeClient() }),
    ).rejects.toThrow(/Invalid wallet address/);
  });
});
