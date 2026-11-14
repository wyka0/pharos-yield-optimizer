"use client";

import { Trophy, Scale, Hourglass, Wallet } from "lucide-react";
import type { OptimizerResult, OptimizerSnapshot } from "@/lib/optimizer/types";
import { money2, signedMoney2, days1, bpsToPct } from "@/lib/format";
import { fmtRaw6, fmtRaw18 } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { MetricCard, BlockBadgeLink, DeltaChip, VerdictBadge } from "./bits";

/** The template's 4-card KPI row, wired to the live optimizer state. */
export function KpiRow({
  snapshot,
  result,
}: {
  snapshot: OptimizerSnapshot;
  result: OptimizerResult;
}) {
   const best = result.best;
   const noSwitch = best?.venueId === result.input.sourceVenue;
   const liveApy = (v: OptimizerSnapshot["vaults"][number]) => result.input.apyBasis === "effective" ? v.effectiveApyBps : v.baseApyBps;
   const top = [...snapshot.vaults].filter((v) => !v.paused).sort((a, b) => liveApy(b) - liveApy(a))[0];

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1 — Top live venue */}
      <MetricCard
         title={`Top Live ${result.input.apyBasis} APY (before allocation)`}
        icon={Trophy}
        value={
           top ? `${bpsToPct(liveApy(top))}%` : "—"
        }
        footer={
           top ? (
            <>
              <Badge variant="accent">
                 {top.shortLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {money2(
                   top.totalAssetsSusdc,
                )}{" "}
                sUSDC TVL
              </span>
            </>
          ) : (
            <Badge variant="warning">no venues readable</Badge>
          )
        }
      />

      {/* 2 — Current verdict */}
      <MetricCard
        title="Optimizer Verdict (current inputs)"
        icon={Scale}
        value={
          <span className={result.verdict === "REBALANCE_RECOMMENDED" ? "" : "text-[var(--color-warning-fg)]"}>
            {result.verdict === "REBALANCE_RECOMMENDED" ? "Rebalance" : "Stay Put"}
          </span>
        }
        footer={
          <>
            <VerdictBadge verdict={result.verdict} />
            {best && (
              <span className="text-xs text-muted-foreground">
                net {signedMoney2(best.expectedNetGainSusdc)} sUSDC
              </span>
            )}
          </>
        }
      />

      {/* 3 — Break-even horizon */}
      <MetricCard
        title="Break-Even Horizon vs Your Horizon"
        icon={Hourglass}
        value={noSwitch ? "No switch" : best ? `${days1(best.breakEvenDays)}d` : "—"}
        footer={
          best ? (
            <>
              {noSwitch ? <Badge variant="secondary">break-even not applicable</Badge> : <DeltaChip positive={best.meetsHoldingPeriod}>
                {result.input.holdingPeriodDays}d {best.meetsHoldingPeriod ? "clears" : "below"} ⌈BE⌉ {Number.isFinite(best.breakEvenDays) ? Math.ceil(best.breakEvenDays) : "∞"}d
              </DeltaChip>}
              <span className="text-xs text-muted-foreground">
                costs {money2(best.totalSwitchingCostSusdc)} sUSDC
              </span>
            </>
          ) : (
            <Badge variant="warning">no comparison</Badge>
          )
        }
      />

      {/* 4 — Wallet liquidity */}
      <MetricCard
        title="Wallet Liquidity (inspected)"
        icon={Wallet}
        value={
          snapshot.wallet ? (
            <>
              {fmtRaw6(snapshot.wallet.susdcRaw)}{" "}
              <span className="text-lg font-normal text-muted-foreground">
                sUSDC + {fmtRaw18(snapshot.wallet.phrsRaw)} PHRS
              </span>
            </>
          ) : (
            "—"
          )
        }
        footer={
          <>
            {snapshot.fromCache ? (
              <Badge variant="warning">cached snapshot</Badge>
            ) : (
              <BlockBadgeLink blockNumber={snapshot.blockNumber} />
            )}
            {snapshot.wallet && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {snapshot.wallet.address.slice(0, 10)}…{snapshot.wallet.address.slice(-6)}
              </span>
            )}
          </>
        }
      />
    </div>
  );
}
