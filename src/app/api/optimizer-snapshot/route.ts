import { NextResponse } from "next/server";
import { readOptimizerSnapshot } from "@/lib/onchain/snapshot-reader";
import { isWellFormedAddress } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/optimizer-snapshot?address=0x…
 *
 * Returns a block-pinned OptimizerSnapshot: live gas price, wallet
 * balances and all 3 vault parameter sets read at ONE block height via
 * batched Multicall3.aggregate3 calls. All amounts are JSON-safe strings
 * alongside human-unit numbers; provenance entries trace every figure.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";

  if (!isWellFormedAddress(address)) {
    return NextResponse.json(
      {
         error: `Invalid wallet address "${address}" — expected a 0x-prefixed 20-byte hex address.`,
      },
      { status: 400 },
    );
  }

  try {
    const snapshot = await readOptimizerSnapshot({ address });
    return NextResponse.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Unknown failure while reading the Pharos Atlantic RPC.",
      },
      { status: 502 },
    );
  }
}
