# Pharos Apex — Horizon-Aware Yield Optimizer

Standalone Pharos Agent Arena **Yield Optimizer** dashboard for **Pharos Atlantic, chain 688689**. Compares three live vaults, explains whether moving capital pays after fees and gas, and prepares unsigned transactions only when the recommendation and inspected balances permit it.

**The agent never holds private keys.** The server is read-only. Signing is an explicit user action through an injected wallet; it is never performed by an agent or backend signer.

## Run

Requires **Node.js 24+** and npm.

```bash
npm ci
npm run build
npm run start                 # http://localhost:3200
# development: npm run dev

npx tsc --noEmit
npx vitest run
npm run audit:noncustodial
npm audit
npx playwright install chromium
npm run test:e2e
npx playwright show-report
```

This is a new project at `C:\pharos-yield-optimizer`. The Sentinel and portfolio projects were used only as read-only references. No existing project was modified; no keys were imported and no real transactions were sent during verification.

## Requirement mapping

| Requirement | Implementation |
|---|---|
| Three live sources | `src/lib/onchain/snapshot-reader.ts`: block-pinned Multicall3 batches, wallet reads, fault isolation and provenance |
| Fees, gas, dilution and minimum hold | `src/lib/optimizer/yield-optimizer.ts`: pure horizon-aware model with live parameters, route-specific gas and a 0.04 sUSDC gas floor |
| Clear move/stay recommendation | Quantitative verdict, 2.00 sUSDC default hurdle, editable source/amount/horizon, five illustrative reviewer presets |
| Unsigned transaction preparation | `src/lib/optimizer/tx-builder.ts`: real ABI-encoded redeem → exact approve → deposit; mutually exclusive guarded route |
| Dashboard design system | White/zinc HSL tokens, Inter typography, fixed 288px sidebar, sticky header, 8px cards, pill badges, padded tables and 350px charts; persistent light/dark themes and five scroll-spy sections |
| Tests and non-custodial audit | Vitest arithmetic, verdict, reader, calldata and safety tests; `tests/non-custodial-airgap.test.ts`; static audit CLI; actual Playwright suite |

## Live contracts

### Network modes: live Atlantic / Mainnet-ready ABI engine

The top header distinguishes **Pharos Atlantic Testnet #688689** from **Mainnet-Ready ABI Engine [0 Balance Required]**. The funded-positions label is conditional on a fresh, address-matching snapshot with positive vault assets; zero or unverified positions are never called funded. The explicit **Inspect funded reference** action selects a different public address for read-only review, not signing authority.

“Mainnet-ready” describes the portable ERC-4626/EIP-155 ABI engine, **not a verified Mainnet deployment or network-switch button**. Reading and encoding unsigned transactions require no agent/deployer wallet balance or Mainnet gas. A Mainnet rollout still needs verified contract addresses, chain/RPC/explorer configuration, firewall policy validation and a fresh snapshot. Actual user execution requires the user's gas and balances. This release executes only on Atlantic.

The non-secret `.env.example` lists every required `NEXT_PUBLIC_*` setting. Set the same values for Vercel's production build and runtime; `.env*` (except the example), `.vercel`, generated reports and dependencies are excluded from publication.

RPC: `https://atlantic.dplabs-internal.com`

| Venue | Address | Relevant reads |
|---|---|---|
| RWA Sovereign T-Bills | `0x001ef1ebebe4167dc0645e33875e9235c7dfaf78` | APYs, fees, TVL, supply, shares, conversion, paused, KYA |
| RWA Senior Private Credit | `0x28080450b7be3963f55296ea9f2b45ad9af1b720` | Same core reads + utilization |
| DeFi Instant Liquidity | `0x4ca5d4c42e4f67ab5b3a8946f3f6434cf265ab77` | Same core reads |
| SentinelUSD (sUSDC, 6 decimals) | `0x3d96d4cc7cd5a0a6d31be15a6d741ca162060c7b` | Balance, symbol and decimals |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | `aggregate3` batches |
| SentinelPolicyFirewall | `0x4bf82bc533befdafa0a0d2154842394b37a40ea1` | Optional `executeGuardedAllocation` |

Vault and wallet reads use one pinned block. **`eth_gasPrice` is a current RPC quote, not a historical block-pinned value**; its provenance associates it with the snapshot, not an assertion of historical gas. Read failures are shown explicitly. A failed block-number refresh can serve a visibly cached snapshot; cached snapshots cannot prepare transactions. Retries and spacing mitigate throttling but cannot guarantee RPC availability.

## Model and honest deployment caveats

For amount `A`, horizon `d`, source rate `s` and chosen live target rate `r`:

```text
exit      = A × sourceExitFeeBps / 10000
entry     = (A − exit) × targetEntryFeeBps / 10000
P         = A − exit − entry
targetAPY = r × targetTVL / (targetTVL + A)
dailyEdge = (P × targetAPY − A × s) / 10000 / 365
cost      = exit + entry + max(live gas converted to sUSDC, 0.04)
net(d)    = dailyEdge × d − cost
breakEven = cost / dailyEdge, or infinity for nonpositive edge
```

Recommend a move only to a different, unpaused venue when the horizon clears `ceil(breakEven)` and net gain clears the hurdle. Staying incurs **zero** switching costs, zero new-allocation dilution and zero incremental net gain. Missing source reads fail closed rather than assuming its rate and fee are zero.

- **Effective APY is the default.** Base APY is an explicitly exploratory option. Both are read from contracts and always displayed; target TVL dilution affects the recommendation under either basis.
- The dilution formula assumes **fixed yield revenue** as capital joins. It is a conservative scenario model, not an on-chain preview or a guarantee about future rates, reserve funding, utilization, default risk or realized returns.
- The source stays invested on its **full original amount**; only the moving principal is reduced by fees. The model does not alter formulas to force illustrative bounty totals.
- Gas units are estimates: standard 285k from a vault / 190k from idle funds; guarded 370k / 275k. PHRS conversion uses a clearly disclosed **$1 reference**, configurable with `NEXT_PUBLIC_PHRS_USD`; this is not a live oracle.
- During verification, Credit reported **1045 base bps, 438 effective bps and 4200 utilization bps**; the deployment computes `base × utilization / 10000`. The sheet's illustrative 983 bps is not substituted for live data.
- The requested wallet is preserved as `0x299cE411D822B92594d77b14A8B239a84B2aC15C` (same address bytes, normalized casing). It had zero balances during verification. `0x299Ce4113abF88F4997737184aa8A7a3D58AC15C` is a **different funded reference address**, not a checksum correction and not assumed to belong to the user. Enter it explicitly only for read-only inspection.

### Five reviewer presets

1. Harbor · 5,000 sUSDC · 90 days.
2. T-Bill · 5,000 sUSDC · 14 days.
3. Senior Credit · 5,000 sUSDC · 60 days.
4. Harbor micro-position · 50 sUSDC · 7 days.
5. Idle wallet · 3,000 sUSDC · 45 days.

Their badges identify **illustrative bounty expectations**, not forced live verdicts. Live APYs and small TVLs can change the target, net gain, break-even and verdict. Tests distinguish observed-size fixtures from explicitly synthetic deep-liquidity fixtures; fixtures are never exposed as live dashboard data.

## Transaction and signing safeguards

- `STAY_PUT` produces zero fund-moving steps.
- A recommended but oversized hypothetical position also produces an empty bundle with a balance warning. The builder never silently resizes it to a smaller executable position.
- Owner/receiver must match the inspected wallet. Cached, mismatched-block, wrong-chain, unavailable and paused sources/targets are refused.
- Redemption uses the deployed virtual-offset conversion (`supply + 10⁶`, `assets + 1`) with integer rounding and source fee-net proceeds. Approval and deposit amounts match; approval is exact, not unlimited.
- The alternative guarded route is **redeem (if needed) → approve FIREWALL → executeGuardedAllocation**, replacing the direct route. It requires a nonzero user-supplied receipt hash and uses a fee-aware, 30-bps-bounded share minimum. The deployed firewall checks receipt-hash **presence**, not cryptographic payment validity; receipt provenance and policy caps must be independently reviewed.
- Opening the right-side signing-review drawer submits nothing. It traps focus, supports Escape while idle, and locks background scrolling. Explicit confirmation checks account and chain, simulates the fixed payload on current state, then requests the user's wallet to sign and broadcast. Each later step stays disabled until the previous receipt succeeds. Pending receipts can be checked manually; no agent sends transactions automatically.
- Payloads are estimates. Wallets do **not** automatically rewrite calldata to match new share prices. A simulation is not a guarantee against changes before mining; inspect proceeds and refresh/review when state changes. Exported JSON requires the same manual checks and sequencing.
- Static scanning checks forbidden key derivation, signing APIs, raw broadcasting and literal key patterns in `src/`. It is a regression safeguard, **not a comprehensive security audit**.

## Verification

See `VERIFICATION.md` for the latest completed results and artifact paths. The Playwright suite includes a real, unmocked live-data test and separate deterministic UI tests. All signing-path tests use a synthetic injected provider; they never send a real transaction.

## Narrated walkthrough workflow

The five-scene recording uses `C:\demo-studio\configs\pharos-yield-optimizer.json`, Christopher Neural narration, and a 1920×1080 viewport. Output: `C:\Users\rashe\Downloads\pharos-yield-optimizer-demo.mp4`.

```powershell
cd C:\demo-studio
npm run record -- configs/pharos-yield-optimizer.json --dry-run
npm run record -- configs/pharos-yield-optimizer.json
ffprobe -v error -show_streams -show_format -of json C:\Users\rashe\Downloads\pharos-yield-optimizer-demo.mp4
```

Scene order: live network overview → 90-day Harbor evaluation → remaining stay illustrations and horizon curves → idle deployment with Direct/Guarded route review → provenance and airgap. Narration must follow observed production values, not assert the sheet's 9.83% Credit APY or fixed verdicts as live facts. Each scene's measured action time must stay within its synthesized narration budget; inspect the emitted timeline for zero failed actions. Recording opens unsigned review only and never confirms a wallet transaction.

## Structure

`src/app` — dashboard and snapshot API · `src/lib/onchain` — read-only RPC · `src/lib/optimizer` — model, presets, types and calldata · `src/components/dashboard` — UI · `tests` — Vitest · `e2e` — Playwright · `scripts` — audit and read-only probes. Detailed formulas and safety boundaries: `ARCHITECTURE.md`.
