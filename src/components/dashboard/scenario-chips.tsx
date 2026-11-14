"use client";

import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SCENARIOS, type ScenarioPreset } from "@/lib/optimizer/scenarios";
export { SCENARIOS, type ScenarioPreset } from "@/lib/optimizer/scenarios";

export function ScenarioChips({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (preset: ScenarioPreset) => void;
}) {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-[var(--color-chart-orange)]" />
        <p className="text-sm font-semibold">One-Click Reviewer Scenarios</p>
        <span className="hidden text-xs text-muted-foreground md:inline">
          — each chip loads source, amount, horizon and hurdle, then re-runs the
          optimizer on live on-chain parameters
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
             type="button"
             data-testid={`scenario-${s.id}`}
             aria-pressed={activeId === s.id}
            onClick={() => onPick(s)}
            className={`group flex h-full cursor-pointer flex-col gap-1.5 rounded-md border p-3 text-left transition-colors ${
              activeId === s.id
                ? "border-primary bg-accent"
                : "border-border bg-card hover:bg-accent"
            }`}
          >
            <span className="text-xs font-semibold leading-tight">{s.title}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              {s.subtitle}
            </span>
            <Badge
              variant="outline"
              className={`mt-auto w-fit text-[10px] ${
                s.expected === "REBALANCE_RECOMMENDED"
                  ? "border-[var(--color-positive)]/40 text-[var(--color-positive)]"
                  : "border-[var(--color-warning)]/40 text-[var(--color-warning-fg)]"
              }`}
            >
              illustration: {s.expected === "REBALANCE_RECOMMENDED" ? "REBALANCE" : "STAY_PUT"}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
