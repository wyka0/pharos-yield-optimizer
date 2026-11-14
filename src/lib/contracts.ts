/**
 * Pharos Atlantic Testnet chain definition + indexed yield-venue registry.
 *
 * Single source of truth shared by the on-chain snapshot reader, the
 * horizon-aware optimizer engine, the unsigned tx-bundle builder and the UI.
 *
 * Live deployed Sentinel suite (see "pharos Sentinel Agent dApp" evidence,
 * `evidence/sentinel-evidence.json`, network.chainId 688689).
 */
import { parseAbi, type Chain } from "viem";

/* ------------------------------- The chain ------------------------------- */

export const PHAROS_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  process.env.PHAROS_RPC_URL ??
  "https://atlantic.dplabs-internal.com";
export const PHAROS_EXPLORER_URL = "https://atlantic.pharosscan.xyz";
export const PHAROS_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? 688689,
);

export const pharosAtlantic: Chain = {
  id: PHAROS_CHAIN_ID,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [PHAROS_RPC_URL] } },
  blockExplorers: {
    default: { name: "PharosScan", url: PHAROS_EXPLORER_URL },
  },
  // Canonical Multicall3 aggregate3 is live at the deterministic address,
  // so batched block-pinned reads work against the public RPC.
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: true,
};

export function addressUrl(address: string): string {
  return `${PHAROS_EXPLORER_URL}/address/${address}`;
}

export function blockUrl(blockNumber: number): string {
  return `${PHAROS_EXPLORER_URL}/block/${blockNumber}`;
}

/* ----------------------------- The contracts ----------------------------- */

export const SUSDC_ADDRESS = (process.env.NEXT_PUBLIC_SUSDC_ADDRESS ??
  "0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b") as `0x${string}`;
export const TBILL_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_TBILL_VAULT_ADDRESS ??
  "0x001ef1ebebe4167dc0645e33875e9235c7dfaf78") as `0x${string}`;
export const CREDIT_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_CREDIT_VAULT_ADDRESS ??
  "0x28080450b7be3963f55296ea9f2b45ad9af1b720") as `0x${string}`;
export const HARBOR_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_HARBOR_VAULT_ADDRESS ??
  "0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77") as `0x${string}`;
export const POLICY_FIREWALL_ADDRESS =
  "0x4bf82bc533befdafa0a0d2154842394b37a40ea1" as `0x${string}`;

/* ------------------------------ Read ABIs -------------------------------- */

/** SentinelUSD (sUSDC) — read surface. */
export const SUSDC_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** Shared read surface of the three SentinelVault4626 yield venues. */
export const VAULT_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function baseApyBps() view returns (uint256)",
  "function effectiveApyBps() view returns (uint256)",
  "function entryFeeBps() view returns (uint256)",
  "function exitFeeBps() view returns (uint256)",
  "function asset() view returns (address)",
  "function symbol() view returns (string)",
  "function paused() view returns (bool)",
]);

/** T-Bill vault extra: KYA collateral-ratio datapoint. */
export const TBILL_EXTRA_ABI = parseAbi([
  "function kyaCollateralRatioBps() view returns (uint256)",
]);

/** Credit vault extra: utilization dilution driver. */
export const CREDIT_EXTRA_ABI = parseAbi([
  "function utilizationBps() view returns (uint256)",
]);

/* ---------------------------- Encode-only ABIs --------------------------- */
/**
 * Write-surface fragments used EXCLUSIVELY with viem's `encodeFunctionData`
 * to prepare UNSIGNED calldata for the user's own wallet to sign.
 * This project never holds keys and never broadcasts — the airgap audit
 * (`npm run audit:noncustodial`) enforces that statically.
 */

/** ERC-4626 vault + ERC-20 encode surface (redeem / approve / deposit). */
export const VAULT_ENCODE_ABI = parseAbi([
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** SentinelPolicyFirewall — optional 1-step guarded allocation route. */
export const FIREWALL_ENCODE_ABI = parseAbi([
  "function executeGuardedAllocation(address vault, uint256 amount, uint256 minSharesOut, bytes32 x402ReceiptHash, bytes32 agentIntentDigest) returns (uint256)",
]);

/* --------------------------- Yield-venue catalog -------------------------- */

export type VenueId = "tbill" | "credit" | "harbor";

/** A source position is one of the 3 vaults or idle wallet sUSDC. */
export type SourceVenueId = VenueId | "wallet_idle";

export interface YieldVenue {
  id: VenueId;
  contractName: string;
  protocolLabel: string;
  shortLabel: string;
  category: "RWA" | "DeFi";
  address: string;
  vaultType: "ERC-4626";
  explorerUrl: string;
  /** Reference headline APY from the bounty sheet — live reads always win. */
  referenceBaseApyBps: number;
}

export const YIELD_VENUES: YieldVenue[] = [
  {
    id: "tbill",
    contractName: "PharosTBillRwaVault",
    protocolLabel: "RWA Sovereign T-Bills",
    shortLabel: "Pharos T-Bill",
    category: "RWA",
    address: TBILL_VAULT_ADDRESS,
    vaultType: "ERC-4626",
    explorerUrl: addressUrl(TBILL_VAULT_ADDRESS),
    referenceBaseApyBps: 815,
  },
  {
    id: "credit",
    contractName: "AtlanticSeniorCreditVault",
    protocolLabel: "RWA Senior Private Credit",
    shortLabel: "Atlantic Senior Credit",
    category: "RWA",
    address: CREDIT_VAULT_ADDRESS,
    vaultType: "ERC-4626",
    explorerUrl: addressUrl(CREDIT_VAULT_ADDRESS),
    referenceBaseApyBps: 1020,
  },
  {
    id: "harbor",
    contractName: "HarborBufferLendingPool",
    protocolLabel: "DeFi Instant Liquidity",
    shortLabel: "Harbor Buffer",
    category: "DeFi",
    address: HARBOR_VAULT_ADDRESS,
    vaultType: "ERC-4626",
    explorerUrl: addressUrl(HARBOR_VAULT_ADDRESS),
    referenceBaseApyBps: 740,
  },
];

export function venueById(id: VenueId): YieldVenue {
  const venue = YIELD_VENUES.find((v) => v.id === id);
  if (!venue) throw new Error(`Unknown venue id "${id}"`);
  return venue;
}

export const SOURCE_VENUE_OPTIONS: Array<{
  id: SourceVenueId;
  label: string;
}> = [
  { id: "harbor", label: "Harbor Buffer (7.40% APY)" },
  { id: "tbill", label: "Pharos T-Bill (8.15% APY)" },
  { id: "credit", label: "Atlantic Senior Credit (9.83% APY)" },
  { id: "wallet_idle", label: "Wallet idle sUSDC (0% APY)" },
];

/* ------------------------- Gas estimation constants ----------------------- */

/** Estimated gas units for the rebalance route (bounty spec). */
export const GAS_UNITS = {
  /** ERC-4626 redeem(shares, receiver, owner) */
  redeem: 95_000,
  /** ERC-20 approve(spender, amount) */
  approve: 55_000,
  /** ERC-4626 deposit(assets, receiver) */
  deposit: 135_000,
} as const;

export const TOTAL_REBALANCE_GAS_UNITS =
  GAS_UNITS.redeem + GAS_UNITS.approve + GAS_UNITS.deposit; // 285,000

/**
 * Reference PHRS price used ONLY to translate live gas (PHRS wei) into a
 * sUSDC-equivalent friction figure. Testnets list no reliable PHRS/USD feed,
 * so we anchor at $1.00 and apply a hard floor (GAS_COST_FLOOR_SUSDC) so gas
 * friction is always visibly accounted for. Overridable via env.
 */
export const PHRS_USD_REFERENCE_PRICE = Number(
  process.env.NEXT_PUBLIC_PHRS_USD ?? 1.0,
);

/** Gas friction never modeled below this sUSDC amount (bounty spec: $0.04). */
export const GAS_COST_FLOOR_SUSDC = 0.04;

/* ------------------------------- Wallets ---------------------------------- */

/**
 * Preserve the requested address, normalized to valid EIP-55 casing.
 * The funded reference wallet is a DIFFERENT address, never substituted.
 */
export const DEFAULT_WALLET =
  "0x299cE411D822B92594d77b14A8B239a84B2aC15C" as const;

export const WALLET_PRESETS: Array<{
  label: string;
  address: string;
  note: string;
}> = [
  {
    label: "Requested wallet",
    address: DEFAULT_WALLET,
    note: "Requested bounty address; zero balances were observed during verification",
  },
  {
    label: "Funded reference wallet (different address)",
    address: "0x299Ce4113abF88F4997737184aa8A7a3D58AC15C",
    note: "Read-only reference; selecting it does not grant signing authority",
  },
  {
    label: "Zero-balance burner",
    address: "0x0000000000000000000000000000000000000001",
    note: "Honest empty state: zero balances, reported as zero — never guessed",
  },
];

export const EIP55_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isWellFormedAddress(value: string): boolean {
  return EIP55_REGEX.test(value.trim());
}
