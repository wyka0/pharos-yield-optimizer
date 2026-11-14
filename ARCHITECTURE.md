# Pharos Apex — Architecture

## 1. Boundaries and data flow

```text
Pharos Atlantic RPC (read-only)
  → pinned wallet/vault Multicall3 reads + latest gas quote
  → GET /api/optimizer-snapshot?address=…
  → pure runOptimizer(input, snapshot)
  → verdict, costs, post-allocation rates and horizon curves
  → balance-validated buildRebalanceTxBundle
  → unsigned JSON or explicit user-wallet review
```

The server has no key storage, signer, custody or broadcasting endpoint. The frontend may request `eth_sendTransaction` **only after user confirmation**; signatures and broadcasting remain inside the injected wallet. The app never receives key material.

## 2. Contracts and snapshot reader

`src/lib/contracts.ts` is the registry of Atlantic chain 688689, RPC, explorer, sUSDC, Multicall3, three vault ABIs and the optional firewall ABI. Exact addresses are listed in `README.md`.

`src/lib/onchain/snapshot-reader.ts`:

- Pins `getBlockNumber` once; all contract reads and `eth_getBalance` use that block.
- Reads share balances, assets, supply, base/effective APYs, entry/exit fees, paused state, asset and symbol; then converts the exact position to assets. Reads Credit utilization and T-Bill KYA separately.
- Uses `Multicall3.aggregate3` via viem multicall. A batch failure isolates its venue; the injectable sequential fallback exists for tests.
- Rejects an unexpected underlying token, underlying decimals or invalid fee range.
- Stores exact uint values as decimal strings. Human sUSDC and shares use 6 decimals; PHRS uses 18.
- Reads `eth_gasPrice` as a **current unpinned quote**, labeled accordingly. Failure yields an explicit unavailable flag and a friction-floor fallback, not a claim that native gas is free.
- Uses 6-second timeouts, two attempts, backoff and ≥120ms spacing. These mitigate rate limits; they do not guarantee uptime. The gate currently serializes completion as well as request starts.
- Keys the bounded 64-entry last-known-good cache by RPC and address. Fallback is used only when block-number retrieval fails and is marked `fromCache`; partial venue failures are reported rather than invisibly replaced with older values.
- Produces per-figure provenance. Gas's block number is associated snapshot context, not a historical gas-price assertion.

## 3. Pure optimizer

`src/lib/optimizer/yield-optimizer.ts` has no I/O. Input: source, gross amount, holding days, net-gain hurdle, APY basis and execution route. Effective APY is the UI default; base is exploratory. Every input change re-evaluates the same snapshot without RPC.

### Rate and principal model

Let `A` be gross source capital, `s` its current selected rate (bps), `r` the target's selected live rate, and `T` target TVL:

```text
X = A × sourceExitFeeBps / 10000
E = (A − X) × targetEntryFeeBps / 10000
P = A − X − E
r_after = r × T / (T + A)
sourceYield(d) = A × s / 10000 × d / 365
targetYield(d) = P × r_after / 10000 × d / 365
dailyEdge = (P × r_after − A × s) / 10000 / 365
switchCost = X + E + gasSusdc
net(d) = dailyEdge × d − switchCost
breakEven = switchCost / dailyEdge, or infinity when dailyEdge ≤ 0
```

Post-allocation dilution is **used**, not merely displayed. It is a fixed-revenue scenario assumption, separate from the vault's current utilization-adjusted `effectiveApyBps()`. Neither it nor APY projections guarantees realized yield. A source candidate represents staying, with no new allocation, no fees, no gas and zero incremental net gain.

### Gas and verdict

Gas units: direct 95k redeem + 55k approval + 135k deposit; guarded 95k redeem + 55k approval + 220k execution. Idle routes omit redemption. Convert live wei to PHRS, then to sUSDC with the disclosed configurable $1/PHRS reference, and apply the **0.04 sUSDC floor**. These are planning estimates; signing uses current simulation and the wallet's fee handling.

Select the highest-net non-source candidate with positive daily edge:

- No positive-edge alternative: stay, `ALREADY_IN_OPTIMAL_VAULT` when a source is available.
- Horizon below `ceil(breakEven)`: `HOLDING_PERIOD_TOO_SHORT`.
- Net gain below the default 2.00 sUSDC hurdle: `NET_GAIN_BELOW_HURDLE`.
- Otherwise: `REBALANCE_RECOMMENDED`.

Paused targets are excluded. Empty reads, missing source, invalid/nonfinite inputs and wrong chain fail closed. A sole source or all-paused snapshot never crashes. Recommendations may be hypothetical; transaction preparation independently checks actual source ownership and balances.

## 4. Unsigned transaction builder

`src/lib/optimizer/tx-builder.ts` uses viem encoding only. Payload fields: `to`, zero native `value`, `data`, selector, Atlantic `chainId`, estimated gas and decoded review arguments. No signing is performed here.

Preconditions: rebalance verdict; matching result/snapshot block and chain; noncached snapshot; matching inspected owner; readable/unpaused route; sufficient gross source position or idle sUSDC. Oversized hypothetical amounts are refused, not silently capped to another amount.

### Exact deployed conversion

The deployed SentinelVault4626 uses `VIRTUAL_OFFSET = 10⁶`:

```text
sharesForGrossAssets = floor(A_raw × (supply + 10⁶) / (assets + 1))
grossRedeemed = ceil(shares × (assets + 1) / (supply + 10⁶))
proceeds = grossRedeemed − floor(grossRedeemed × exitFeeBps / 10000)
```

Full-position sizing uses the live share balance when requested gross capital covers the rounded position; otherwise it redeems a partial position. Source fees reduce proceeds; capital is not grossed up to compensate for them. Approval/deposit uses those pinned estimated proceeds. No drift discount is currently applied. Lazy accrual and mining-time changes still require current simulation and manual review.

### Routes are mutually exclusive

**Direct:** redeem (vault sources only) → exact token approve TARGET → target deposit with USER as receiver.

**Guarded:** redeem (if needed) → exact token approve FIREWALL → `executeGuardedAllocation(target, amount, minSharesOut, receiptHash, intentDigest)`.

The guarded share minimum mirrors deployed `previewDeposit`: round-up virtual-offset conversion, then subtract the fee in shares, then apply a 30-bps margin. The deterministic digest includes wallet, source, target, amount and block. A nonzero bytes32 receipt is required by the app. The contract's actual check is nonzero receipt **presence**, not cryptographic verification of a payment. Policy spend caps, whitelist, emergency state and replay state are ultimately validated by simulation/on-chain execution; the app does not configure or bypass policies.

## 5. Frontend signing boundary

`src/components/dashboard/tx-bundle.tsx`:

1. Review modal opens without calling the wallet.
2. Explicit confirmation requests accounts and checks owner and Atlantic chain.
3. `eth_call` simulates the fixed step at current state. Reject if the bundle changes before submission.
4. User wallet receives `eth_sendTransaction`; no application signer exists.
5. Successful receipt unlocks the next step. Pending receipt state disables resubmission and can be checked manually. If receipt retrieval fails after submission, retain the hash as pending.
6. Input/snapshot/route changes invalidate review/completion state; an already-submitted old transaction is surfaced for independent tracking.

Fixed calldata is **not rewritten by a wallet**. A successful simulation can become stale before mining. JSON exports are unsigned instructions, not signed transactions; users must verify chain, balances, allowances, current policy and proceeds and execute in order. The app never automatically executes a bundle.

## 6. UI and accessibility

Five sections: optimizer/verdict, live comparison, break-even, transaction bundle, provenance. Recharts shows live base/effective bars and numeric-domain horizon curves with true break-even coordinates. Chart horizon is bounded at 730 days to avoid pathological allocations while inputs cover 1–365 days.

The Rexora-derived theme supports persisted light/dark mode, desktop collapse and mobile drawer. Navigation uses smooth scrolling and IntersectionObserver scroll-spy with `aria-current`. Editable controls, theme toggle, wallet inspector and review modal have accessible labels. Wide tables scroll within their cards; long firewall labels wrap on mobile.

## 7. Verification and caveats

- Vitest: independent fee/gas/rate math, exact zero crossings, input/read guards, illustrative deep-liquidity scenarios, low-TVL verdict changes, calldata decoding, virtual offsets, owner/balance/receipt guards and static non-custodial regression scan.
- Playwright: unmocked live RPC plus deterministic UI fixtures; all five presets, controls, charts, navigation/scroll-spy, themes, mobile layout, export, guarded-route replacement, modal and mock wallet refusal/confirmation sequencing.
- `scripts/audit-noncustodial.mjs`: forbidden key derivation/signing/raw-broadcast patterns in `src/`. Pattern scanning is not a substitute for a security audit.
- Next.js 15 is retained. Vitest was updated to 5; PostCSS is overridden to a patched compatible version. Node.js 24+ is required. See `VERIFICATION.md` for actual completed gates.
- Requested wallet and live Credit APY differ from the sheet's illustrations; the app does not substitute a funded address or fabricate an effective rate. See README for exact values and identities.
