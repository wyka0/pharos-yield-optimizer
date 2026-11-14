"use client";

import { RefreshCw, Database, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OptimizerSnapshot } from "@/lib/optimizer/types";
import { BlockBadgeLink } from "./bits";

/** Live-data status bar: pinned block, cache state, refresh control. */
export function StatusStrip({
  snapshot,
  loading,
  onRefresh,
}: {
  snapshot: OptimizerSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
      <Badge variant={snapshot && !snapshot.fromCache ? "positive" : "warning"}>
        <Database className="mr-1 size-3" />
        {loading
          ? "Reading chain…"
          : snapshot?.fromCache
            ? "last-known-good cache"
            : "live @ pinned block"}
      </Badge>
      {snapshot && <BlockBadgeLink blockNumber={snapshot.blockNumber} />}
      {snapshot && (
        <span className="text-xs text-muted-foreground">
           {snapshot.gasPriceUnavailable ? "gas unavailable — friction floor" : `gas ${snapshot.gasPriceGwei.toFixed(1)} gwei (latest quote)`} ·{" "}
          {snapshot.vaults.length}/3 venues readable
        </span>
      )}
      {snapshot && snapshot.unreadableVenues.length > 0 && (
        <Badge variant="warning">
          <AlertTriangle className="mr-1 size-3" />
          {snapshot.unreadableVenues.length} source(s) isolated — not guessed
        </Badge>
      )}
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        Re-read @ latest block
      </Button>
    </div>
  );
}
