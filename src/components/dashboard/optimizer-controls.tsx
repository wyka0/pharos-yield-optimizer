"use client";

import { Coins, CalendarClock, Flag, GitCompareArrows } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  SOURCE_VENUE_OPTIONS,
  type SourceVenueId,
} from "@/lib/contracts";
import type { OptimizerInput } from "@/lib/optimizer/types";

/**
 * Interactive inputs for the optimizer: source position, amount, holding
 * horizon (1–365d), minimum net-gain hurdle and the APY basis toggle.
 * Every change re-runs the pure engine against the pinned snapshot.
 */
export function OptimizerControls({
  input,
  onChange,
  disabled,
}: {
  input: OptimizerInput;
  onChange: (next: OptimizerInput) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<OptimizerInput>) => onChange({ ...input, ...patch });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* Source position */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <GitCompareArrows className="size-4 text-muted-foreground" />
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source Position
          </label>
        </div>
         <select
           aria-label="Source Position"
          className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          value={input.sourceVenue}
          onChange={(e) => set({ sourceVenue: e.target.value as SourceVenueId })}
          disabled={disabled}
        >
          {SOURCE_VENUE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Where your capital sits today — any of the 3 live vaults, or idle
          sUSDC in your wallet earning 0%.
        </p>
      </div>

      {/* Amount */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Coins className="size-4 text-muted-foreground" />
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Amount (sUSDC)
          </label>
        </div>
         <Input
           aria-label="Amount (sUSDC)"
          type="number"
          min={1}
          max={100000}
          step={10}
          value={input.amountSusdc}
          onChange={(e) =>
            set({ amountSusdc: Math.max(0, Number(e.target.value) || 0) })
          }
          disabled={disabled}
          className="font-mono"
        />
        <input
          type="range"
          min={10}
          max={20000}
          step={10}
          value={Math.min(20000, input.amountSusdc)}
          onChange={(e) => set({ amountSusdc: Number(e.target.value) })}
          className="mt-3"
          aria-label="Amount slider"
          disabled={disabled}
        />
      </div>

      {/* Horizon */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Holding Horizon
          </label>
        </div>
        <div className="flex items-center gap-2">
           <Input
             aria-label="Holding Horizon"
            type="number"
            min={1}
            max={365}
            value={input.holdingPeriodDays}
            onChange={(e) =>
              set({
                holdingPeriodDays: Math.min(
                  365,
                  Math.max(1, Math.round(Number(e.target.value) || 1)),
                ),
              })
            }
            disabled={disabled}
            className="font-mono"
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
        <input
          type="range"
          min={1}
          max={365}
          value={input.holdingPeriodDays}
          onChange={(e) => set({ holdingPeriodDays: Number(e.target.value) })}
          className="mt-3"
          aria-label="Holding horizon slider"
          disabled={disabled}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>1d</span>
          <span>180d</span>
          <span>365d</span>
        </div>
      </div>

      {/* Hurdle + APY basis */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Flag className="size-4 text-muted-foreground" />
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Min Net Gain Hurdle
          </label>
        </div>
        <div className="flex items-center gap-2">
           <Input
             aria-label="Min Net Gain Hurdle"
            type="number"
            min={0}
            step={0.5}
            value={input.minNetGainSusdc}
            onChange={(e) =>
              set({ minNetGainSusdc: Math.max(0, Number(e.target.value) || 0) })
            }
            disabled={disabled}
            className="font-mono"
          />
          <span className="text-sm text-muted-foreground">sUSDC</span>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Yield basis:</span>
          <button
            type="button"
            onClick={() => set({ apyBasis: "base" })}
            disabled={disabled}
            className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              input.apyBasis === "base"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            base APY
          </button>
          <button
            type="button"
            onClick={() => set({ apyBasis: "effective" })}
            disabled={disabled}
            className={`cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              input.apyBasis === "effective"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
             effective APY
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          Both live on-chain.{" "}
          <Badge variant="outline" className="px-1 py-0 text-[9px]">
            effective = base × utilization
          </Badge>{" "}
           on the credit vault. Selected rates are then diluted by TVL / (TVL + amount).
        </p>
      </div>
    </div>
  );
}
