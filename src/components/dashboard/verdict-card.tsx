"use client";

import {
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  Fuel,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { OptimizerResult } from "@/lib/optimizer/types";
import { money2, signedMoney2, days1, bpsToPct } from "@/lib/format";
import { DeltaChip, VerdictBadge } from "./bits";

/** Fee/gas line item in the cost breakdown table. */
function CostRow({
  label,
  value,
  hint,
  positive,
}: {
  label: string;
  value: string;
  hint?: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
      </div>
      <span
        className={`font-mono text-sm font-medium tabular-nums ${
          positive === true
            ? "text-[var(--color-positive)]"
            : positive === false
              ? "text-[var(--color-negative)]"
              : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Requirement 03 — the verdict. A clear REBALANCE_RECOMMENDED with the
 * expected net gain, or STAY_PUT with the exact quantitative reason, plus
 * the full cost/yield breakdown and the three rubric condition checks.
 */
export function VerdictCard({
  result,
  gasPriceGwei,
  onPrepareBundle,
  bundleBusy,
}: {
  result: OptimizerResult;
  gasPriceGwei: number;
  onPrepareBundle: () => void;
  bundleBusy: boolean;
}) {
  const best = result.best;
  const rebalance = result.verdict === "REBALANCE_RECOMMENDED";
  const noSwitch = best?.venueId === result.input.sourceVenue;

  return (
    <Card data-testid="live-verdict" data-verdict={result.verdict} className="border-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base font-medium">Optimizer Verdict</CardTitle>
            <VerdictBadge verdict={result.verdict} />
            {result.verdictCode && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {result.verdictCode}
              </Badge>
            )}
          </div>
          <CardDescription className="mt-1.5 max-w-3xl leading-relaxed">
            {result.reason}
          </CardDescription>
        </div>
        {rebalance && best && (
          <Button onClick={onPrepareBundle} disabled={bundleBusy}>
            {bundleBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRightLeft className="size-4" />
            )}
            Prepare Unsigned Tx Bundle
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {!best ? (
          <p className="text-sm text-muted-foreground">
            No readable candidate venues — nothing to compare. Re-read the chain.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Switching costs (Requirement 02) */}
            <div className="rounded-lg border border-border bg-background/50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Fuel className="size-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Switching Costs → {best.shortLabel}
                </p>
              </div>
              <CostRow
                 label={`Source exit fee (${result.input.sourceVenue === "wallet_idle" ? "idle wallet" : `${Math.round(best.sourceExitFeeSusdc / result.input.amountSusdc * 10000)} bps`})`}
                value={`${money2(best.sourceExitFeeSusdc)} sUSDC`}
                positive={false}
              />
              <CostRow
                label={`Target entry fee (${best.entryFeeBps} bps)`}
                value={`${money2(best.targetEntryFeeSusdc)} sUSDC`}
                positive={false}
              />
              <CostRow
                label="Gas (live eth_gasPrice)"
                value={`${money2(best.estimatedGasCostSusdc)} sUSDC`}
                hint={`${best.gasUnits.toLocaleString()} units @ ${gasPriceGwei.toFixed(1)} gwei · $0.04 floor`}
                positive={false}
              />
              <div className="mt-2 border-t border-border pt-2">
                <CostRow
                  label="Total switching cost"
                  value={`${money2(best.totalSwitchingCostSusdc)} sUSDC`}
                  positive={false}
                />
              </div>
            </div>

            {/* Horizon-aware yield model */}
            <div className="rounded-lg border border-border bg-background/50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <ArrowRightLeft className="size-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {result.input.holdingPeriodDays}-Day Yield Model
                </p>
              </div>
              <CostRow
                label={`Stay in ${result.sourceShortLabel} (${bpsToPct(result.sourceEffectiveApyBps)}%)`}
                value={`${money2(best.sourceProjectedYieldSusdc)} sUSDC`}
              />
              <CostRow
                label={`${noSwitch ? "Remain in" : "Move to"} ${best.shortLabel} (${bpsToPct(best.chosenApyBps)}%) on ${money2(best.postFeePrincipalSusdc)} post-fee`}
                value={`${money2(best.targetGrossYieldSusdc)} sUSDC`}
              />
              <CostRow
                label="Gross yield advantage"
                value={signedMoney2(best.grossYieldAdvantageSusdc)}
                positive={best.grossYieldAdvantageSusdc >= 0}
              />
              <div className="mt-2 border-t border-border pt-2">
                <CostRow
                  label="Expected NET gain (after all costs)"
                  value={`${signedMoney2(best.expectedNetGainSusdc)} sUSDC`}
                  positive={best.expectedNetGainSusdc >= 0}
                />
              </div>
            </div>

            {/* Break-even + rubric checks */}
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-background/50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <ShieldCheck className="size-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Break-Even & Conditions
                  </p>
                </div>
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {noSwitch ? "No switch" : days1(best.breakEvenDays)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {noSwitch ? "zero switching costs" : "days to recover fees + gas"}
                  </span>
                  {!noSwitch && <DeltaChip positive={best.meetsHoldingPeriod}>
                    horizon {result.input.holdingPeriodDays}d{" "}
                    {best.meetsHoldingPeriod ? "≥" : "<"} ⌈break-even⌉{" "}
                    {Number.isFinite(best.breakEvenDays)
                      ? Math.ceil(best.breakEvenDays)
                      : "∞"}
                    d
                  </DeltaChip>}
                </div>
                <ul className="space-y-1.5">
                  {result.checks.map((check) => (
                    <li key={check.label} className="flex items-start gap-1.5">
                      {check.passed ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--color-positive)]" />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-[var(--color-negative)]" />
                      )}
                      <div>
                        <p className="text-xs font-medium">{check.label}</p>
                        <p className="text-[10px] leading-snug text-muted-foreground">
                          {check.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
