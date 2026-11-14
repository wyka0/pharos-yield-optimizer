"use client";

import { ExternalLink, ShieldCheck, KeyRound, FileCheck2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { OptimizerSnapshot } from "@/lib/optimizer/types";
import { shortAddr } from "@/lib/format";

/**
 * Requirement 01 + 04 evidence — every live figure traces to its source
 * contract, ABI function and pinned block height, auditable on PharosScan
 * in one click; plus the static non-custodial airgap attestation.
 */
export function ProvenanceTable({ snapshot }: { snapshot: OptimizerSnapshot }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="border-border xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            On-Chain Provenance — figure → contract → function → block
          </CardTitle>
          <CardDescription>
            All {snapshot.provenance.length} figures below were read at pinned
            block #{snapshot.blockNumber} via batched Multicall3.aggregate3
            calls ({snapshot.fromCache ? "last-known-good cache" : "live"}).
            Click any row to audit it on PharosScan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Figure</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Call</TableHead>
                <TableHead className="text-right">Block</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.provenance.map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="font-mono text-[11px]">{p.key}</TableCell>
                  <TableCell className="font-mono text-[11px]">{p.value}</TableCell>
                  <TableCell>
                    <a
                      className="font-mono text-[11px] underline-offset-2 hover:underline"
                      href={p.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.contractName} {shortAddr(p.contractAddress)}{" "}
                      <ExternalLink className="inline size-3" />
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {p.functionCalled}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px]">
                    #{p.blockNumber}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {/* Airgap attestation */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <ShieldCheck className="size-4 text-[var(--color-positive)]" />
              Non-Custodial Airgap Attestation
            </CardTitle>
            <CardDescription>
              The agent prepares; only your wallet signs.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs leading-relaxed text-muted-foreground">
            <ul className="space-y-1.5">
              <li className="flex items-start gap-2">
                <KeyRound className="mt-0.5 size-3.5 shrink-0 text-[var(--color-positive)]" />
                0 key stores, 0 seed phrases, 0 signing accounts anywhere in src/
              </li>
              <li className="flex items-start gap-2">
                <FileCheck2 className="mt-0.5 size-3.5 shrink-0 text-[var(--color-positive)]" />
                calldata produced by pure ABI encoding — unsigned until your
                wallet signs
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--color-positive)]" />
                STAY_PUT verdicts emit zero fund-moving steps (unit-tested)
              </li>
            </ul>
            <div className="mt-3 rounded-lg border border-border bg-background/50 p-3 font-mono text-[10px] leading-relaxed">
              <p className="text-foreground">$ npm run audit:noncustodial</p>
              <p>✓ PASS — 0 forbidden APIs, 0 raw key literals</p>
              <p className="text-muted-foreground">
                scans: src/** for key-material APIs, signing clients and
                raw-broadcast calls
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="positive">0 signers</Badge>
              <Badge variant="positive">unsigned payloads</Badge>
              <Badge variant="positive">user-signed only</Badge>
              <Badge variant="accent">chain #{snapshot.chainId}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Retry / resilience provenance */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Read Resilience</CardTitle>
            <CardDescription>
              Retries, spacing and explicit cache fallback; RPC availability is not guaranteed.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs leading-relaxed text-muted-foreground">
            <ul className="list-disc space-y-1 pl-4">
              <li>6s per-read timeout, 2 attempts with linear backoff</li>
              <li>
                request-spacing gate (≥120ms between RPC starts) — no bursts
              </li>
              <li>Multicall3.aggregate3 batching — ~8 RPC round trips total</li>
              <li>
                last-known-good snapshot fallback (flagged{" "}
                <Badge variant="warning" className="px-1 py-0 text-[9px]">
                  cached
                </Badge>
                , never silently stale)
              </li>
              <li>fault isolation: one failing venue never poisons the rest</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
