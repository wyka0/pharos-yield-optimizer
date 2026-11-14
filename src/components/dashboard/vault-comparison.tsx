"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OptimizerResult, OptimizerSnapshot } from "@/lib/optimizer/types";
import { money2, signedMoney2, bpsToPct } from "@/lib/format";
import { BlockBadgeLink, DeltaChip } from "./bits";

/**
 * Requirement 01 — the 3-vault live comparison. Every row is read on-chain
 * at the pinned block (Multicall3 aggregate3): APYs, fee schedule, TVL,
 * utilization / KYA, pause state, plus the optimizer's net-gain evaluation
 * of each venue as a move target from the user's current position.
 */
export function VaultComparison({
  snapshot,
  result,
}: {
  snapshot: OptimizerSnapshot;
  result: OptimizerResult;
}) {
  const chartData = useMemo(
    () =>
      snapshot.vaults.map((v) => ({
        name: v.shortLabel,
        base: v.baseApyBps / 100,
        effective: v.effectiveApyBps / 100,
      })),
    [snapshot],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Live comparison table */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            Live Vault Parameters — read at one pinned block
          </CardTitle>
          <CardDescription>
            Multicall3.aggregate3 batched reads of totalAssets, totalSupply,
            convertToAssets, baseApyBps, effectiveApyBps, entry/exitFeeBps and
            paused — per venue, plus your live position.{" "}
            <BlockBadgeLink blockNumber={snapshot.blockNumber} />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead className="text-right">Base APY</TableHead>
                 <TableHead className="text-right">Effective APY</TableHead>
                 <TableHead className="text-right">Modeled target APY</TableHead>
                <TableHead className="text-right">Entry / Exit fee</TableHead>
                <TableHead className="text-right">TVL (totalAssets)</TableHead>
                <TableHead className="text-right">Utilization / KYA</TableHead>
                <TableHead className="text-right">Your position</TableHead>
                <TableHead className="text-right">Net gain if moved to</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.vaults.map((v) => {
                const evalRow = result.candidates.find((c) => c.venueId === v.id);
                const isSource = result.input.sourceVenue === v.id;
                return (
                  <TableRow key={v.id} className={isSource ? "bg-[var(--color-accent)]/25" : ""}>
                    <TableCell>
                      <a
                        href={v.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {v.shortLabel}
                      </a>
                      <p className="text-[10px] text-muted-foreground">
                        {v.contractName} · {v.category}
                      </p>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {bpsToPct(v.baseApyBps)}%
                    </TableCell>
                   <TableCell className="text-right font-mono tabular-nums">
                     {bpsToPct(v.effectiveApyBps)}%
                   </TableCell>
                   <TableCell className="text-right font-mono tabular-nums">{evalRow ? `${bpsToPct(evalRow.postAllocationApyBps)}%` : "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {v.entryFeeBps} / {v.exitFeeBps} bps
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money2(v.totalAssetsSusdc)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {v.utilizationBps !== null
                        ? `${bpsToPct(v.utilizationBps)}`
                        : v.kyaCollateralRatioBps !== null
                          ? `KYA ${bpsToPct(v.kyaCollateralRatioBps)}`
                          : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money2(v.userAssetsSusdc)}
                    </TableCell>
                    <TableCell className="text-right">
                      {evalRow ? (
                        <DeltaChip positive={evalRow.expectedNetGainSusdc >= 0}>
                          {signedMoney2(evalRow.expectedNetGainSusdc)} · BE{" "}
                          {Number.isFinite(evalRow.breakEvenDays)
                            ? `${Math.ceil(evalRow.breakEvenDays)}d`
                            : "∞"}
                        </DeltaChip>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {v.paused ? (
                        <Badge variant="destructive">paused</Badge>
                      ) : isSource ? (
                        <Badge variant="accent">current position</Badge>
                      ) : (
                        <Badge variant="positive">live</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {snapshot.unreadableVenues
                .filter((u) => u.id !== "wallet" && u.id !== "rpc")
                .map((u) => (
                  <TableRow key={u.id} className="opacity-60">
                    <TableCell>
                      {u.label}
                      <p className="text-[10px] text-muted-foreground">
                        unreadable — excluded from all figures, never guessed
                      </p>
                    </TableCell>
                     <TableCell className="text-right text-muted-foreground">—</TableCell>
                     <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell className="text-right text-muted-foreground">—</TableCell>
                    <TableCell>
                      <Badge variant="warning">isolated</Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* APY bar chart */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            Live APY Comparison — base vs utilization-diluted effective
          </CardTitle>
          <CardDescription>
            Both series are on-chain reads at block #{snapshot.blockNumber}. The
            credit vault&apos;s effectiveApyBps = baseApyBps × utilization ⁄ 10⁴
            ({snapshot.vaults.find((v) => v.id === "credit")?.baseApyBps ?? "—"} ×{" "}
            {(snapshot.vaults.find((v) => v.id === "credit")?.utilizationBps ?? 0) / 100}
            %).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--background)",
                    borderColor: "var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--foreground)",
                    fontSize: "12px",
                  }}
                  formatter={(value, name) => [
                    `${Number(value).toFixed(2)}%`,
                    name === "base" ? "baseApyBps()" : "effectiveApyBps()",
                  ] as [string, string]}
                />
                <Legend
                  formatter={(value: string) =>
                    value === "base" ? "Base APY (headline)" : "Effective APY (diluted)"
                  }
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="base" fill="var(--color-chart-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="effective" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
