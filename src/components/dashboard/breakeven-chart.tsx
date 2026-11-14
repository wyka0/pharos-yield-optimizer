"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { OptimizerResult } from "@/lib/optimizer/types";
import { money2, signedMoney2, days1 } from "@/lib/format";
import { DeltaChip } from "./bits";

const SERIES_COLORS: Record<string, string> = {
  tbill: "var(--primary)",
  credit: "var(--color-chart-blue)",
  harbor: "var(--color-chart-teal)",
};

/**
 * Requirement 02 visualized — net gain vs holding horizon for every
 * candidate venue, net of exit + entry fees and live gas. The curve crosses
 * zero exactly at each venue's break-even horizon; the user's chosen
 * horizon is marked. A move is only recommended when the horizon sits
 * safely past break-even AND clears the net-gain hurdle.
 */
export function BreakEvenChart({ result }: { result: OptimizerResult }) {
  const { data, maxDays, marks } = useMemo(() => {
    const best = result.best;
    if (!best) return { data: [], maxDays: 90, marks: [] as Array<{ id: string; days: number; net: number }> };

    const dailyEdges = new Map(
      result.candidates.map((c) => [
        c.venueId,
        {
          daily: c.dailyYieldAdvantageSusdc,
          switching: c.totalSwitchingCostSusdc,
          breakEven: c.breakEvenDays,
          net: c.expectedNetGainSusdc,
        },
      ]),
    );
    const horizon = result.input.holdingPeriodDays;
    const longestBE = Math.max(
      ...[...dailyEdges.values()]
        .map((v) => (Number.isFinite(v.breakEven) ? v.breakEven : 0))
        .filter((v) => Number.isFinite(v) && v > 0),
      0,
    );
     const maxDays = Math.min(730, Math.max(90, Math.ceil(Math.max(horizon, longestBE) * 1.25)));

    const pts: Array<Record<string, number | null>> = [];
    const step = maxDays > 400 ? 15 : maxDays > 200 ? 5 : 2;
    for (let d = 0; d <= maxDays; d += d === 0 ? 1 : step) {
      const row: Record<string, number | null> = { days: d };
      for (const [id, v] of dailyEdges) {
        // net(d) = dailyEdge × d − switchingCost (the engine's exact model)
        row[id] = Math.round((v.daily * d - v.switching) * 1000) / 1000;
      }
      pts.push(row);
    }
    // Ensure the user's horizon is an exact point on every series.
    if (!pts.some((p) => p.days === horizon)) {
      const row: Record<string, number | null> = { days: horizon };
      for (const [id, v] of dailyEdges) {
        row[id] = Math.round((v.daily * horizon - v.switching) * 1000) / 1000;
      }
      pts.push(row);
      pts.sort((a, b) => (a.days as number) - (b.days as number));
    }

    const marks = result.candidates
      .filter((c) => Number.isFinite(c.breakEvenDays) && c.breakEvenDays <= maxDays)
       .map((c) => ({ id: c.venueId, days: c.breakEvenDays, net: 0 }));

    return { data: pts, maxDays, marks };
  }, [result]);

  const best = result.best;

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-border">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-base font-medium">
              Net Gain vs Holding Horizon — where curves cross zero, moving pays
            </CardTitle>
            <CardDescription>
               net(d) = (post-fee principal × post-allocation APY − full amount × source APY)
               × d ⁄ 365 − (exit + entry + gas). Fixed-revenue dilution model; rates may change.
            </CardDescription>
          </div>
          {best && (
            <div className="flex flex-wrap items-center gap-2">
              <DeltaChip positive={best.expectedNetGainSusdc >= 0}>
                {signedMoney2(best.expectedNetGainSusdc)} sUSDC @ {result.input.holdingPeriodDays}d
              </DeltaChip>
              <span className="text-xs text-muted-foreground">
                break-even {days1(best.breakEvenDays)}d
              </span>
              <span className="text-xs text-muted-foreground">
                daily edge {money2(best.dailyYieldAdvantageSusdc)} sUSDC
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                 <XAxis
                   type="number"
                   domain={[0, maxDays]}
                  dataKey="days"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(d: number) => `${d}d`}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--background)",
                    borderColor: "var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--foreground)",
                    fontSize: "12px",
                  }}
                  labelFormatter={(d) => `Horizon: ${String(d)} days`}
                  formatter={(value, name) => [
                    `${Number(value).toFixed(2)} sUSDC`,
                    result.candidates.find((c) => c.venueId === name)?.shortLabel ?? String(name),
                  ] as [string, string]}
                />
                <Legend
                  formatter={(value: string) =>
                    result.candidates.find((c) => c.venueId === value)?.shortLabel ?? value
                  }
                />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <ReferenceLine
                  x={result.input.holdingPeriodDays}
                  stroke="var(--color-chart-orange)"
                  strokeDasharray="6 3"
                  label={{
                    value: `your ${result.input.holdingPeriodDays}d`,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "var(--muted-foreground)",
                  }}
                />
                {result.candidates.map((c) => (
                  <Line
                    key={c.venueId}
                    type="monotone"
                    dataKey={c.venueId}
                    stroke={SERIES_COLORS[c.venueId] ?? "#888"}
                    strokeWidth={c.venueId === best?.venueId ? 2.5 : 1.5}
                    dot={false}
                    strokeOpacity={c.venueId === best?.venueId ? 1 : 0.65}
                  />
                ))}
                {marks.map((m) => (
                  <ReferenceDot
                    key={m.id}
                    x={m.days}
                    y={0}
                    r={4}
                    fill={SERIES_COLORS[m.id] ?? "#888"}
                    stroke="none"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Dots on the zero line mark each venue&apos;s break-even horizon
            {best && !Number.isFinite(best.breakEvenDays)
              ? ` — ${best.shortLabel} never breaks even at this spread (ΔAPY ≤ 0), so its line never crosses zero.`
              : "."}{" "}
            Switching-cost composition (exit + entry + gas) shifts each curve
            down by its exact total.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
