import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { blockUrl } from "@/lib/contracts";

/** Apex four-card KPI layout with real on-chain content. */
export function MetricCard({
  title,
  value,
  footer,
  icon: Icon,
}: {
  title: string;
  value: React.ReactNode;
  footer: React.ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-2 p-6 pb-2">
        <span className="text-sm font-medium">{title}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="p-6 pt-0">
        <p className="mb-2 text-2xl font-bold tabular-nums">{value}</p>
        <div className="flex flex-wrap items-center gap-2">{footer}</div>
      </div>
    </div>
  );
}

/** Block badge linking to PharosScan (reused across cards/tables). */
export function BlockBadgeLink({ blockNumber }: { blockNumber: number }) {
  return (
    <a
      href={blockUrl(blockNumber)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[11px] font-semibold text-foreground underline-offset-2 hover:underline"
      title="Open this block height on PharosScan"
    >
      Block #{blockNumber} ↗
    </a>
  );
}

/** Positive/negative delta chip in the template accent style. */
export function DeltaChip({
  children,
  positive = true,
}: {
  children: React.ReactNode;
  positive?: boolean;
}) {
  return (
    <Badge
      variant="accent"
      className={
        positive
          ? "bg-[var(--color-positive)]/15 text-[var(--color-positive)]"
          : "bg-[var(--color-negative)]/15 text-[var(--color-negative)]"
      }
    >
      {children}
    </Badge>
  );
}

/** Verdict badge — REBALANCE_RECOMMENDED (green) vs STAY_PUT (amber). */
export function VerdictBadge({ verdict }: { verdict: string }) {
  const rebalance = verdict === "REBALANCE_RECOMMENDED";
  return (
    <Badge
      className={
        rebalance
          ? "border-transparent bg-[var(--color-positive)] text-white"
          : "border-transparent bg-[var(--color-warning)]/25 text-[var(--color-warning-fg)]"
      }
    >
      {rebalance ? "▲ REBALANCE_RECOMMENDED" : "⏹ STAY_PUT"}
    </Badge>
  );
}
