import { expect, it } from "vitest";
import { deepLiquiditySnapshot } from "./helpers/mock-snapshot";
import { runOptimizer } from "@/lib/optimizer/yield-optimizer";
import { buildRebalanceTxBundle } from "@/lib/optimizer/tx-builder";
const input = { sourceVenue: "wallet_idle" as const, amountSusdc: 3000, holdingPeriodDays: 45, minNetGainSusdc: 2, apyBasis: "effective" as const };
for (const issue of ["wallet mismatch", "cache", "block mismatch", "insufficient idle", "no receipt", "zero receipt", "paused source", "insufficient shares"] as const) {
  it(`withholds calldata on ${issue}`, () => {
    const snapshot = deepLiquiditySnapshot();
    const result = runOptimizer(input, snapshot);
    const args = { snapshot, result, walletAddress: snapshot.wallet!.address, includeFirewallStep: false, x402ReceiptHash: undefined as `0x${string}` | undefined };
    if (issue === "wallet mismatch") args.walletAddress = "0x0000000000000000000000000000000000000001";
    if (issue === "cache") snapshot.fromCache = true;
    if (issue === "block mismatch") snapshot.blockNumber++;
    if (issue === "insufficient idle") snapshot.wallet!.susdcRaw = "1";
    if (issue === "no receipt" || issue === "zero receipt") { args.includeFirewallStep = true; if (issue === "zero receipt") args.x402ReceiptHash = `0x${"0".repeat(64)}`; }
    if (issue === "paused source" || issue === "insufficient shares") {
      result.input.sourceVenue = "harbor";
      const source = snapshot.vaults.find((v) => v.id === "harbor")!;
      if (issue === "paused source") source.paused = true; else source.userSharesRaw = "0";
    }
    expect(buildRebalanceTxBundle(args).steps).toHaveLength(0);
  });
}
