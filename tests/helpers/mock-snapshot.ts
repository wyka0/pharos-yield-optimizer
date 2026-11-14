/**
 * Deterministic mock OptimizerSnapshot built from the bounty sheet's live
 * parameter set (credit base 1020 → diluted 983, T-Bill 815, Harbor 740),
 * used by the optimizer math, scenario-verdict and tx-builder tests.
 */
import type { OptimizerSnapshot, VaultLive } from "@/lib/optimizer/types";

export function mockVault(overrides: Partial<VaultLive> & Pick<VaultLive, "id">): VaultLive {
  return {
    contractName: "MockVault",
    protocolLabel: "Mock Venue",
    shortLabel: "Mock",
    category: "RWA",
    address: "0x0000000000000000000000000000000000000000",
    explorerUrl: "https://atlantic.pharosscan.xyz/address/0x0",
    blockNumber: 4_242_424,
    totalAssetsSusdc: 1_000_000,
    totalSupplyShares: 1_000_000,
    sharePriceSusdc: 1,
    baseApyBps: 0,
    effectiveApyBps: 0,
    entryFeeBps: 0,
    exitFeeBps: 0,
    utilizationBps: null,
    kyaCollateralRatioBps: null,
    paused: false,
    userShares: 0,
    userSharesRaw: "0",
    userAssetsSusdc: 0,
    totalAssetsRaw: "1000000000000",
    totalSupplyRaw: "1000000000000",
    ...overrides,
  };
}

/** Bounty-sheet parameter set (10 gwei gas → the $0.04 sUSDC floor applies). */
export function mockSnapshot(): OptimizerSnapshot {
  return {
    chainId: 688689,
    chainName: "Pharos Atlantic Testnet",
    rpcEndpoint: "https://atlantic.dplabs-internal.com",
    explorerUrl: "https://atlantic.pharosscan.xyz",
    blockNumber: 4_242_424,
    readAtIso: "2026-01-01T00:00:00.000Z",
    fromCache: false,
    gasPriceWei: "10000000000", // 10 gwei — 285k units ≈ 0.00285 PHRS → floored
    gasPriceGwei: 10,
    wallet: {
      address: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C",
      susdc: 3003.934926,
      susdcRaw: "3003934926",
      phrs: 0.040321156,
      phrsRaw: "40321156000000000",
    },
    vaults: [
      mockVault({
        id: "tbill",
        address: "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78",
        explorerUrl: "https://atlantic.pharosscan.xyz/address/0x001ef1ebebe4167dc0645e33875e9235c7dfaf78",
        contractName: "PharosTBillRwaVault",
        protocolLabel: "RWA Sovereign T-Bills",
        shortLabel: "Pharos T-Bill",
        baseApyBps: 815,
        effectiveApyBps: 815,
        entryFeeBps: 0,
        exitFeeBps: 0,
        kyaCollateralRatioBps: 10280,
        totalAssetsSusdc: 8494.816451,
        totalSupplyShares: 8497.008032,
        sharePriceSusdc: 0.999743,
        userShares: 8497.008032,
        userSharesRaw: "8497008032",
        userAssetsSusdc: 8493.816827,
        totalAssetsRaw: "8494816451",
        totalSupplyRaw: "8497008032",
      }),
      mockVault({
        id: "credit",
        address: "0x28080450b7be3963f55296ea9f2b45ad9af1b720",
        explorerUrl: "https://atlantic.pharosscan.xyz/address/0x28080450b7be3963f55296ea9f2b45ad9af1b720",
        contractName: "AtlanticSeniorCreditVault",
        protocolLabel: "RWA Senior Private Credit",
        shortLabel: "Atlantic Senior Credit",
        baseApyBps: 1020,
        effectiveApyBps: 983,
        entryFeeBps: 12,
        exitFeeBps: 5,
        utilizationBps: 4200,
        totalAssetsSusdc: 8001.313608,
        totalSupplyShares: 8000,
        sharePriceSusdc: 1.000164,
        userShares: 8000,
        userSharesRaw: "8000000000",
        userAssetsSusdc: 8000.313569,
        totalAssetsRaw: "8001313608",
        totalSupplyRaw: "8000000000",
      }),
      mockVault({
        id: "harbor",
        address: "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
        explorerUrl: "https://atlantic.pharosscan.xyz/address/0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77",
        contractName: "HarborBufferLendingPool",
        protocolLabel: "DeFi Instant Liquidity",
        shortLabel: "Harbor Buffer",
        category: "DeFi",
        baseApyBps: 740,
        effectiveApyBps: 740,
        entryFeeBps: 0,
        exitFeeBps: 5,
        totalAssetsSusdc: 5000.00007,
        totalSupplyShares: 5000,
        sharePriceSusdc: 1.000000014,
        userShares: 5000,
        userSharesRaw: "5000000000",
        userAssetsSusdc: 4999.00027,
        totalAssetsRaw: "5000000070",
        totalSupplyRaw: "5000000000",
      }),
    ],
    unreadableVenues: [],
    provenance: [],
    allVenueReadsFailed: false,
  };
}

/** Explicit synthetic deep-liquidity fixture, NOT a claim about live TVL. */
export function deepLiquiditySnapshot(): OptimizerSnapshot {
  const snapshot = mockSnapshot();
  for (const vault of snapshot.vaults) {
    vault.totalAssetsSusdc = 1_000_000_000;
    vault.totalSupplyShares = 1_000_000_000;
    vault.totalAssetsRaw = "1000000000000000";
    vault.totalSupplyRaw = "1000000000000000";
    vault.sharePriceSusdc = 1;
  }
  return snapshot;
}
