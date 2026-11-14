/**
 * On-chain data layer — block-pinned, batched, fault-isolated, read-only.
 *
 * Guarantees (Requirement 01 — "live on-chain data"):
 *  1. EVERY read is pinned to ONE block height (`getBlockNumber()` once, then
 *     `blockNumber` passed to each call) so the snapshot is internally
 *     consistent and the optimizer math is reproducible.
 *  2. Each read has a 6s timeout + 2-attempt retry; a last-known-good cache
 *     serves as fallback under testnet rate-limiting (flagged `fromCache`).
 *  3. Outgoing request STARTS pass through a spacing gate so the public
 *     Atlantic RPC's per-second limit is never bursted.
 *  4. All contract reads are batched into single Multicall3.aggregate3
 *     eth_calls (one per wave) — 3 vaults + wallet + gas ≈ 8 RPC round trips.
 *  5. Read-only: only `view` calls. The tx builder prepares UNSIGNED
 *     calldata; nothing here ever signs or broadcasts.
 */
import {
  createPublicClient,
  getAddress,
  http,
  type PublicClient,
} from "viem";
import {
  CREDIT_EXTRA_ABI,
  PHAROS_CHAIN_ID,
  PHAROS_EXPLORER_URL,
  PHAROS_RPC_URL,
  SUSDC_ABI,
  SUSDC_ADDRESS,
  TBILL_EXTRA_ABI,
  VAULT_ABI,
  YIELD_VENUES,
  addressUrl,
  isWellFormedAddress,
  pharosAtlantic,
  type VenueId,
} from "@/lib/contracts";
import type {
  OptimizerSnapshot,
  ProvenanceEntry,
  UnreadableVenue,
  VaultLive,
  WalletLive,
} from "@/lib/optimizer/types";

/* ----------------------------- Configuration ----------------------------- */

export const READ_TIMEOUT_MS = 6_000;
export const READ_ATTEMPTS = 2;

/* --------------------- Injectable client (for tests) --------------------- */

/** Minimal structural client so tests can inject a fake RPC. */
export interface ReadClient {
  getBlockNumber(args?: { blockTag?: "latest" }): Promise<bigint>;
  getBalance(args: {
    address: `0x${string}`;
    blockNumber?: bigint;
  }): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  readContract(args: {
    address: `0x${string}`;
    abi: unknown;
    functionName: string;
    args?: readonly unknown[];
    blockNumber?: bigint;
  }): Promise<unknown>;
  multicall?(args: {
    contracts: ReadonlyArray<{
      address: `0x${string}`;
      abi: unknown;
      functionName: string;
      args?: readonly unknown[];
    }>;
    allowFailure?: boolean;
    blockNumber?: bigint;
  }): Promise<unknown[]>;
}

export interface ReadSnapshotOptions {
  address: string;
  rpcUrl?: string;
  /** Injectable client (tests); defaults to a live viem HTTP client. */
  client?: ReadClient;
  /** Backoff between retry attempts (ms). Default 400; tests may set 0. */
  retryBackoffMs?: number;
  /** Minimum spacing between outgoing RPC request starts (ms). Default 120. */
  requestSpacingMs?: number;
}

/* ------------------------------ Primitives ------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------- request-spacing gate -------------------------- */

let gateTail: Promise<void> = Promise.resolve();
let lastRequestStart = 0;

/**
 * Serializes request STARTS with a minimum spacing so the public RPC's
 * per-second rate limit is never bursted.
 */
function gateRequest<T>(fn: () => Promise<T>, spacingMs: number): Promise<T> {
  const run = async (): Promise<T> => {
    if (spacingMs > 0) {
      const wait = spacingMs - (Date.now() - lastRequestStart);
      if (wait > 0) await sleep(wait);
    }
    lastRequestStart = Date.now();
    return fn();
  };
  const result = gateTail.then(run, run);
  gateTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: read timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function readWithRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts: number = READ_ATTEMPTS,
  timeoutMs: number = READ_TIMEOUT_MS,
  backoffMs: number = 400,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(backoffMs * attempt);
    }
  }
  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed after ${attempts} attempts: ${reason}`);
}

interface BatchCall {
  address: `0x${string}`;
  abi: unknown;
  functionName: string;
  args?: readonly unknown[];
}

/** One Multicall3.aggregate3 eth_call per batch, pinned to the block. */
async function readBatch(
  client: ReadClient,
  calls: BatchCall[],
  blockNumber: bigint,
  label: string,
  backoffMs: number,
  spacingMs: number,
): Promise<unknown[]> {
  if (typeof client.multicall === "function") {
    return readWithRetry(
      `${label} (multicall ×${calls.length})`,
      () =>
        gateRequest(
          () =>
            client.multicall!({
              contracts: calls,
              allowFailure: false,
              blockNumber,
            }),
          spacingMs,
        ),
      READ_ATTEMPTS,
      READ_TIMEOUT_MS,
      backoffMs,
    );
  }
  const results: unknown[] = [];
  for (const call of calls) {
    results.push(
      await readWithRetry(
        `${label}.${call.functionName}`,
        () =>
          gateRequest(
            () => client.readContract({ ...call, blockNumber }),
            spacingMs,
          ),
        READ_ATTEMPTS,
        READ_TIMEOUT_MS,
        backoffMs,
      ),
    );
  }
  return results;
}

/* ----------------------- Last-known-good cache --------------------------- */

const lastKnownGood = new Map<string, OptimizerSnapshot>();

/** Test hook. */
export function resetLastKnownGoodCache(): void {
  lastKnownGood.clear();
}

function cacheKey(address: string, rpcUrl: string): string {
  return `${rpcUrl}:${address.toLowerCase()}`;
}

/* ------------------------------ Figure help ------------------------------ */

function susdc(raw: bigint): number {
  return Number(raw) / 1e6;
}

function provenanceEntry(
  key: string,
  value: string,
  contractName: string,
  contractAddress: string,
  functionCalled: string,
  blockNumber: number,
): ProvenanceEntry {
  return {
    key,
    value,
    contractName,
    contractAddress,
    functionCalled,
    blockNumber,
    explorerUrl: isWellFormedAddress(contractAddress) ? addressUrl(contractAddress) : `${PHAROS_EXPLORER_URL}/block/${blockNumber}`,
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------ Wallet read ------------------------------ */

async function readWallet(
  address: string,
  client: ReadClient,
  blockNumber: bigint,
  backoffMs: number,
  spacingMs: number,
  provenance: ProvenanceEntry[],
): Promise<WalletLive> {
  const checksummed = getAddress(address);
  const block = Number(blockNumber);

  const phrsRaw = await readWithRetry(
    "wallet.phrs eth_getBalance",
    () =>
      gateRequest(
        () => client.getBalance({ address: checksummed, blockNumber }),
        spacingMs,
      ),
    READ_ATTEMPTS,
    READ_TIMEOUT_MS,
    backoffMs,
  );

  const [susdcRaw, susdcSymbol, susdcDecimals] = await readBatch(
    client,
    [
      {
        address: SUSDC_ADDRESS,
        abi: SUSDC_ABI,
        functionName: "balanceOf",
        args: [checksummed],
      },
      { address: SUSDC_ADDRESS, abi: SUSDC_ABI, functionName: "symbol" },
      { address: SUSDC_ADDRESS, abi: SUSDC_ABI, functionName: "decimals" },
    ],
    blockNumber,
    "wallet.susdc",
    backoffMs,
    spacingMs,
  ) as [bigint, string, number];

  provenance.push(
    provenanceEntry(
      "wallet.phrs",
      `${Number(phrsRaw) / 1e18} PHRS`,
      "Pharos Native Ledger (RPC)",
      checksummed,
      "eth_getBalance",
      block,
    ),
    provenanceEntry(
      "wallet.susdc",
      `${susdc(susdcRaw)} ${String(susdcSymbol)}`,
      `SentinelUSD (${String(susdcSymbol)})`,
      SUSDC_ADDRESS,
      "balanceOf(address)",
      block,
    ),
  );
   if (Number(susdcDecimals) !== 6) throw new Error("Underlying token decimals do not match the six-decimal deployment.");

  return {
    address: checksummed,
    susdc: susdc(susdcRaw),
    susdcRaw: susdcRaw.toString(),
    phrs: Number(phrsRaw) / 1e18,
    phrsRaw: phrsRaw.toString(),
  };
}

/* ------------------------------- Vault read ------------------------------ */

async function readVault(
  venueId: VenueId,
  wallet: string,
  client: ReadClient,
  blockNumber: bigint,
  backoffMs: number,
  spacingMs: number,
  provenance: ProvenanceEntry[],
): Promise<VaultLive> {
  const venue = YIELD_VENUES.find((v) => v.id === venueId)!;
  const addr = venue.address as `0x${string}`;
  const block = Number(blockNumber);
  const checksummedWallet = getAddress(wallet);

  // Wave 1 — everything except convertToAssets (depends on share balance).
  const [
    shareBalanceRaw,
    totalAssetsRaw,
    totalSupplyRaw,
    baseApy,
    effApy,
    entryFee,
    exitFee,
    paused,
    assetAddress,
    shareSymbol,
  ] = await readBatch(
    client,
    [
      {
        address: addr,
        abi: VAULT_ABI,
        functionName: "balanceOf",
        args: [checksummedWallet],
      },
      { address: addr, abi: VAULT_ABI, functionName: "totalAssets" },
      { address: addr, abi: VAULT_ABI, functionName: "totalSupply" },
      { address: addr, abi: VAULT_ABI, functionName: "baseApyBps" },
      { address: addr, abi: VAULT_ABI, functionName: "effectiveApyBps" },
      { address: addr, abi: VAULT_ABI, functionName: "entryFeeBps" },
      { address: addr, abi: VAULT_ABI, functionName: "exitFeeBps" },
      { address: addr, abi: VAULT_ABI, functionName: "paused" },
      { address: addr, abi: VAULT_ABI, functionName: "asset" },
      { address: addr, abi: VAULT_ABI, functionName: "symbol" },
    ],
    blockNumber,
    venueId,
    backoffMs,
    spacingMs,
   ) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, string, string];
   if (assetAddress.toLowerCase() !== SUSDC_ADDRESS.toLowerCase()) throw new Error("Vault underlying does not match SentinelUSD.");
   if (entryFee < 0n || entryFee > 10000n || exitFee < 0n || exitFee > 10000n) throw new Error("Vault fee is outside the valid basis-point range.");

  // Wave 2 — value the wallet's exact share balance at the same block.
  const [assetsValueRaw] = await readBatch(
    client,
    [
      {
        address: addr,
        abi: VAULT_ABI,
        functionName: "convertToAssets",
        args: [shareBalanceRaw],
      },
    ],
    blockNumber,
    `${venueId}.convertToAssets`,
    backoffMs,
    spacingMs,
  ) as [bigint];

  const provenanceBase = {
    contractName: venue.contractName,
    contractAddress: venue.address,
    blockNumber: block,
  };
  const prov = (key: string, value: string, fn: string) =>
    provenance.push(provenanceEntry(key, value, provenanceBase.contractName, provenanceBase.contractAddress, fn, block));

  prov(`${venueId}.totalAssets`, `${susdc(totalAssetsRaw)} sUSDC`, "totalAssets()");
  prov(`${venueId}.totalSupply`, `${susdc(totalSupplyRaw)} shares`, "totalSupply()");
  prov(`${venueId}.baseApyBps`, `${baseApy} bps (${Number(baseApy) / 100}%)`, "baseApyBps()");
  prov(`${venueId}.effectiveApyBps`, `${effApy} bps (${Number(effApy) / 100}%)`, "effectiveApyBps()");
  prov(`${venueId}.entryFeeBps`, `${entryFee} bps`, "entryFeeBps()");
  prov(`${venueId}.exitFeeBps`, `${exitFee} bps`, "exitFeeBps()");
  prov(`${venueId}.paused`, String(paused), "paused()");
  prov(`${venueId}.userShares`, `${susdc(shareBalanceRaw)} ${String(shareSymbol)}`, "balanceOf(address)");
  prov(`${venueId}.userAssets`, `${susdc(assetsValueRaw)} sUSDC`, "convertToAssets(uint256)");

  let utilizationBps: number | null = null;
  let kyaCollateralRatioBps: number | null = null;

  if (venueId === "tbill") {
    const [kya] = await readBatch(
      client,
      [
        {
          address: addr,
          abi: TBILL_EXTRA_ABI,
          functionName: "kyaCollateralRatioBps",
        },
      ],
      blockNumber,
      `${venueId}.kya`,
      backoffMs,
      spacingMs,
    ) as [bigint];
    kyaCollateralRatioBps = Number(kya);
    prov(`${venueId}.kyaCollateralRatioBps`, `${kya} bps`, "kyaCollateralRatioBps()");
  }

  if (venueId === "credit") {
    const [util] = await readBatch(
      client,
      [
        {
          address: addr,
          abi: CREDIT_EXTRA_ABI,
          functionName: "utilizationBps",
        },
      ],
      blockNumber,
      `${venueId}.utilization`,
      backoffMs,
      spacingMs,
    ) as [bigint];
    utilizationBps = Number(util);
    prov(`${venueId}.utilizationBps`, `${util} bps`, "utilizationBps()");
  }

  const totalSupply = Number(totalSupplyRaw);

  return {
    id: venueId,
    contractName: venue.contractName,
    protocolLabel: venue.protocolLabel,
    shortLabel: venue.shortLabel,
    category: venue.category,
    address: venue.address,
    explorerUrl: venue.explorerUrl,
    blockNumber: block,
    totalAssetsSusdc: susdc(totalAssetsRaw),
     totalSupplyShares: susdc(totalSupplyRaw),
     sharePriceSusdc: totalSupply > 0 ? Number(totalAssetsRaw) / totalSupply : 1,
    baseApyBps: Number(baseApy),
    effectiveApyBps: Number(effApy),
    entryFeeBps: Number(entryFee),
    exitFeeBps: Number(exitFee),
    utilizationBps,
    kyaCollateralRatioBps,
    paused,
    userShares: susdc(shareBalanceRaw),
    userSharesRaw: shareBalanceRaw.toString(),
    userAssetsSusdc: susdc(assetsValueRaw),
    totalAssetsRaw: totalAssetsRaw.toString(),
    totalSupplyRaw: totalSupplyRaw.toString(),
  };
}

/* ------------------------------ Entry point ------------------------------ */

export async function readOptimizerSnapshot(
  options: ReadSnapshotOptions,
): Promise<OptimizerSnapshot> {
  const rawAddress = options.address.trim();
  if (!isWellFormedAddress(rawAddress)) {
    throw new Error(
      `Invalid wallet address "${rawAddress}" — expected a 0x-prefixed 20-byte address.`,
    );
  }
   const address = getAddress(rawAddress.toLowerCase());

  const client: ReadClient =
    options.client ??
    (createPublicClient({
      chain: pharosAtlantic,
      transport: http(options.rpcUrl ?? PHAROS_RPC_URL, {
        timeout: READ_TIMEOUT_MS,
        retryCount: 0, // retries are handled explicitly by readWithRetry
      }),
    }) as unknown as ReadClient);

   const key = cacheKey(address, options.rpcUrl ?? PHAROS_RPC_URL);
  const backoffMs = options.retryBackoffMs ?? 400;
  const spacingMs = options.requestSpacingMs ?? 120;
  const provenance: ProvenanceEntry[] = [];

  // 1. Pin every subsequent read to a single block height.
  let blockNumber: bigint;
  try {
    blockNumber = await readWithRetry(
      "getBlockNumber",
      () => gateRequest(() => client.getBlockNumber(), spacingMs),
      READ_ATTEMPTS,
      READ_TIMEOUT_MS,
      backoffMs,
    );
  } catch (err) {
    // Last-known-good fallback for transient RPC throttling.
    const cached = lastKnownGood.get(key);
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        unreadableVenues: [
          {
            id: "rpc",
            label: "Pharos Atlantic RPC (getBlockNumber)",
            contractAddress: PHAROS_RPC_URL,
            blockNumberAttempted: cached.blockNumber,
            reason:
              "Live refresh failed; serving the last-known-good block-pinned snapshot (figures stay pinned to the cached block, marked stale — never guessed). " +
              `Error: ${describeError(err)}`,
          },
          ...cached.unreadableVenues,
        ],
      };
    }
    throw new Error(
      `Unable to reach the Pharos Atlantic RPC (${PHAROS_RPC_URL}) and no last-known-good cache exists yet: ${describeError(err)}`,
    );
  }

   // 2. eth_gasPrice is a current quote: JSON-RPC offers no historical block tag.
   let gasPriceWei = 0n;
   let gasPriceUnavailable = false;
  try {
    gasPriceWei = await readWithRetry(
         "eth_gasPrice (latest quote, not block-pinned)",
      () => gateRequest(() => client.getGasPrice(), spacingMs),
      READ_ATTEMPTS,
      READ_TIMEOUT_MS,
      backoffMs,
    );
    provenance.push(
      provenanceEntry(
        "rpc.gasPrice",
        `${gasPriceWei} wei (${Number(gasPriceWei) / 1e9} gwei)`,
         "Pharos Atlantic RPC",
         PHAROS_RPC_URL,
         "eth_gasPrice (latest quote, not block-pinned)",
        Number(blockNumber),
      ),
    );
   } catch {
     // Gas is optional: the friction model falls back to its $0.04 floor.
     gasPriceUnavailable = true;
  }

  // 3. Fault-isolated parallel reads — one failing venue never poisons the rest.
  const [walletResult, ...vaultResults] = await Promise.allSettled([
    readWallet(address, client, blockNumber, backoffMs, spacingMs, provenance),
    ...YIELD_VENUES.map((v) =>
      readVault(
        v.id,
        address,
        client,
        blockNumber,
        backoffMs,
        spacingMs,
        provenance,
      ),
    ),
  ]);

   const unreadableVenues: UnreadableVenue[] = [];
   if (gasPriceUnavailable) unreadableVenues.push({ id: "rpc", label: "Gas quote unavailable", contractAddress: options.rpcUrl ?? PHAROS_RPC_URL, blockNumberAttempted: Number(blockNumber), reason: "eth_gasPrice failed; using the 0.04 sUSDC friction floor, not a zero-cost gas claim." });
  let wallet: WalletLive | null = null;
  if (walletResult.status === "fulfilled") {
    wallet = walletResult.value;
  } else {
    unreadableVenues.push({
      id: "wallet",
      label: "Wallet balances (PHRS + sUSDC)",
      contractAddress: address,
      blockNumberAttempted: Number(blockNumber),
      reason: describeError(walletResult.reason),
    });
  }

  const vaults: VaultLive[] = [];
  YIELD_VENUES.forEach((venue, i) => {
    const result = vaultResults[i];
    if (result.status === "fulfilled") {
      vaults.push(result.value);
      return;
    }
    unreadableVenues.push({
      id: venue.id,
      label: `${venue.protocolLabel} (${venue.contractName})`,
      contractAddress: venue.address,
      blockNumberAttempted: Number(blockNumber),
      reason: describeError(result.reason),
    });
  });

  const snapshot: OptimizerSnapshot = {
    chainId: PHAROS_CHAIN_ID,
    chainName: "Pharos Atlantic Testnet",
    rpcEndpoint: options.rpcUrl ?? PHAROS_RPC_URL,
    explorerUrl: PHAROS_EXPLORER_URL,
    blockNumber: Number(blockNumber),
    readAtIso: new Date().toISOString(),
    fromCache: false,
    gasPriceWei: gasPriceWei.toString(),
     gasPriceGwei: Number(gasPriceWei) / 1e9,
     gasPriceUnavailable,
    wallet,
    vaults,
    unreadableVenues,
    provenance,
    allVenueReadsFailed: vaults.length === 0,
  };

  if (vaults.length > 0) {
     lastKnownGood.set(key, snapshot);
     if (lastKnownGood.size > 64) lastKnownGood.delete(lastKnownGood.keys().next().value!);
  }

  return snapshot;
}

/** Exported for tests / tooling. */
export { getAddress };
