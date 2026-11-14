# Verification — 14 November 2026

Project: `C:\pharos-yield-optimizer` · locally verified production build: **http://localhost:3200**.

## Completed gates

| Command | Final result |
|---|---|
| `npx tsc --noEmit` | Passed, no TypeScript errors |
| `npx vitest run` | **72/72 passed, 6 suites** |
| `npm run build` | Passed, Next.js 15.5.29 production build |
| `npm run audit:noncustodial` | Passed, 33 source files, zero forbidden key/signing/raw-broadcast patterns |
| `npm audit` | Zero known dependency vulnerabilities |
| `npm run test:e2e` | **19/19 passed** in Chromium against the final production build (51.1 seconds) |
| `node scripts/verify-live-ui.mjs` | Unmocked HTTP 200 page/API, zero console errors, 1920×1080 screenshots, funded-reference inspection, missing-receipt refusal, unsigned drawer, and zero mobile overflow |

No Sentinel or portfolio project was changed. No real wallet signatures or transactions were performed. Publishing/deployment and recording evidence is emitted outside the repository after its single-root publication so the tracked checkout remains clean.

## Live-data evidence

`artifacts/verification/live-snapshot.json` contains the unmocked snapshot captured at **block 32748772**, `2026-11-14T02:37:14.026Z`:

- Chain 688689; three readable vaults; 32 provenance entries; `fromCache: false`.
- Requested inspected address: `0x299cE411D822B92594d77b14A8B239a84B2aC15C`.
- This address had **zero sUSDC, zero PHRS and zero vault shares**.
- T-Bill: 815 base/effective bps, TVL 8,494.816451 sUSDC, 0/0 bps entry/exit.
- Credit: 1045 base bps, **438 effective bps**, 4200 utilization bps, TVL 8,001.313608 sUSDC, 12/5 bps entry/exit.
- Harbor: 740 base/effective bps, TVL 5,000.000070 sUSDC, 0/5 bps entry/exit.
- Current gas quote: 10 gwei; explicitly labeled **not block-pinned**. The planning gas-floor model applies at this quote.

These are captured testnet observations, not promises about future state. Live verdicts are allowed to differ from the bounty's illustrations. The funded reference address is a different wallet, not a checksum correction.

## Playwright coverage

`e2e/dashboard.spec.ts` exercises:

1. Unmocked live RPC response, chain, requested wallet, three same-block vaults, provenance, all five preset inputs and absence of uncaught page errors.
2–6. Each reviewer preset against an explicitly synthetic, sufficiently funded deep-liquidity fixture; correct verdict and empty/nonempty unsigned bundle.
7. Low-TVL dilution changing the verdict; editable amount/source/hurdle and APY-basis switching.
8. Recharts bars, three horizon lines, break-even dots; all five smooth-scroll links, scroll-spy and desktop sidebar collapse.
9. Persistent theme switching; 390×844 mobile drawer and absence of document-level horizontal overflow.
10. Downloaded JSON's unsigned metadata, required sender, chain/value fields; guarded route receipt requirement and replacement of direct deposit.
11. Full-height right review drawer opens without submission; explicit confirmation handles absent wallet.
12. Exact 288px sidebar width/position, sticky header, Inter font, 8px cards, explicit funded-reference inspection and Direct/Guarded route controls.
13–15. Synthetic wallet account/network/simulation rejection before any send request.
16. Synthetic successful receipt gates the next step; new scenario invalidates old completion state.
17. Invalid wallet input and honest RPC-error UI, with no signing controls.
18. Clipboard export and explicit live-refresh request.
19. Synthetic post-submission receipt outage retains pending hash, prevents duplicate send, and unlocks only after confirmation.

All wallet-provider responses in signing tests are synthetic. `eth_sendTransaction` is mocked and never broadcasts. Deterministic UI fixtures are injected only by Playwright request interception; the production API has no fixture/mock mode.

## Reports and screenshots

`artifacts/verification/live-ui/` preserves the latest live verification at block **32766632**: requested/funded JSON snapshots, full live-UI report, 1080p light/dark screenshots, unsigned drawer, chart/table comparison, and a 390px mobile screenshot. The funded reference held **3,003.93 sUSDC** liquid; it is a different address from the zero-balance requested wallet. Latest preset verdicts: **STAY_PUT / STAY_PUT / REBALANCE_RECOMMENDED / STAY_PUT / REBALANCE_RECOMMENDED**. Preset 3 selected T-Bill with **+3.61 sUSDC** modeled net gain and **24.8 days** break-even; idle deployment selected T-Bill with **+22.24 sUSDC** modeled net gain. All observations can drift; illustrative 9.83% Credit APY is not used in live math.

- `playwright-report/index.html` — final passing report, including attached live snapshot.
- `artifacts/verification/live-desktop-dark.png` — actual live dashboard, desktop dark theme.
- `artifacts/verification/synthetic-desktop-light.png` — deterministic UI fixture, light theme.
- `artifacts/verification/synthetic-mobile-light.png` — deterministic UI fixture, mobile light theme.
- `artifacts/verification/live-snapshot.json` — separate captured live JSON.

Run `npx playwright show-report` to inspect the report. `test-results/` and the report are regenerated by future runs; the copies under `artifacts/verification/` preserve this evidence.

## Remaining limitations

- The production/video workflow and output paths are documented in README; ffprobe and timeline evidence are emitted outside the published checkout.
- Static non-custodial scanning and passing tests are not a full security audit.
- APYs, fixed-revenue TVL dilution, native-token reference price and gas limits are model assumptions/estimates, not realized-yield guarantees or a live price oracle.
- Exported routes and real-wallet execution still require current-state simulation, confirmation sequencing and user review. Simulated success cannot guarantee mining-time success.
- The optional firewall's receipt check verifies nonzero hash presence, not cryptographic payment validity; user-supplied provenance and live policies must be checked independently.
