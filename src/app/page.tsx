"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_WALLET } from "@/lib/contracts";
import type {
  OptimizerInput,
  OptimizerSnapshot,
  TxBundle as TxBundleData,
} from "@/lib/optimizer/types";
import { runOptimizer, DEFAULT_MIN_NET_GAIN_SUSDC } from "@/lib/optimizer/yield-optimizer";
import { buildRebalanceTxBundle } from "@/lib/optimizer/tx-builder";
import { DashboardHeader } from "@/components/dashboard/header";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { StatusStrip } from "@/components/dashboard/status-strip";
import { PageHeader, SectionHeader } from "@/components/dashboard/page-header";
import { KpiRow } from "@/components/dashboard/kpi-row";
import {
  ScenarioChips,
  SCENARIOS,
  type ScenarioPreset,
} from "@/components/dashboard/scenario-chips";
import { OptimizerControls } from "@/components/dashboard/optimizer-controls";
import { VerdictCard } from "@/components/dashboard/verdict-card";
import { VaultComparison } from "@/components/dashboard/vault-comparison";
import { BreakEvenChart } from "@/components/dashboard/breakeven-chart";
import { TxBundle } from "@/components/dashboard/tx-bundle";
import { ProvenanceTable } from "@/components/dashboard/provenance-table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function SkeletonPulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonPulse key={i} className="h-[150px] rounded-xl border" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonPulse className="h-[420px] rounded-xl border lg:col-span-2" />
        <SkeletonPulse className="h-[420px] rounded-xl border" />
      </div>
    </div>
  );
}

const DEFAULT_INPUT: OptimizerInput = {
  ...SCENARIOS[0].input,
   apyBasis: "effective",
};

export default function Home() {
  const [address, setAddress] = useState<string>(DEFAULT_WALLET);
  const [snapshot, setSnapshot] = useState<OptimizerSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<OptimizerInput>(DEFAULT_INPUT);
  const [activeScenario, setActiveScenario] = useState<string | null>(
    SCENARIOS[0].id,
  );
   const [includeFirewall, setIncludeFirewall] = useState<boolean>(false);
   const [receiptHash, setReceiptHash] = useState("");
  // Left navigation sidebar — open by default so reviewers see it immediately;
  // the header hamburger toggles it on both desktop and mobile.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const loadToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ address });
      const res = await fetch(`/api/optimizer-snapshot?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (token !== loadToken.current) return; // superseded by a newer request
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ??
            `HTTP ${res.status} from /api/optimizer-snapshot`,
        );
      }
      setSnapshot(body as OptimizerSnapshot);
    } catch (err) {
      if (token !== loadToken.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "Unknown error while reading the optimizer snapshot.",
      );
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setSidebarOpen(false);
  }, []);

  // The pure optimizer engine runs client-side against the pinned snapshot,
  // so every slider/chip change re-verdicts instantly without extra RPC.
  const result = useMemo(
     () => (snapshot ? runOptimizer({ ...input, executionRoute: includeFirewall ? "guarded" : "standard" }, snapshot) : null),
     [input, snapshot, includeFirewall],
  );

  // Requirement 04 — unsigned bundle exists ONLY for REBALANCE verdicts.
  const bundle: TxBundleData | null = useMemo(() => {
    if (!snapshot || !result) return null;
    return buildRebalanceTxBundle({
      result,
      snapshot,
      includeFirewallStep: includeFirewall,
       walletAddress: snapshot.wallet?.address ?? address,
       x402ReceiptHash: /^0x[0-9a-fA-F]{64}$/.test(receiptHash) ? receiptHash as `0x${string}` : undefined,
    });
   }, [snapshot, result, includeFirewall, address, receiptHash]);

  function pickScenario(preset: ScenarioPreset) {
    setActiveScenario(preset.id);
    setInput({ ...preset.input, apyBasis: input.apyBasis });
  }

  function scrollToBundle() {
    document
      .getElementById("txbundle")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar snapshot={snapshot} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={sidebarOpen ? "min-w-0 lg:pl-72" : "min-w-0"}>
        <DashboardHeader
          address={address}
          onAddressChange={setAddress}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          snapshot={snapshot}
        />

        <main className="min-w-0 p-4 md:p-6 lg:p-8">
        <StatusStrip
          snapshot={snapshot}
          loading={loading}
          onRefresh={() => void load()}
        />

            {error ? (
              <Card className="border-destructive/50 p-6">
                <h2 className="text-base font-bold text-destructive">
                  Unable to read the Pharos Atlantic chain — nothing will be guessed
                </h2>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{error}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  The optimizer deliberately refuses to fabricate figures. Check
                  the RPC endpoint (
                  <code className="font-mono">https://atlantic.dplabs-internal.com</code>)
                  and press Re-read.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => void load()}>
                  ↻ Re-read @ latest block
                </Button>
              </Card>
            ) : !snapshot || !result ? (
              <LoadingSkeleton />
            ) : (
              <div className="flex flex-col gap-8">
                {/* ============ 1 · Optimizer & Verdict ============ */}
                <section id="optimizer">
                  <PageHeader
                    title="Optimizer Desk & Verdict"
                    description="Horizon-aware net-yield optimization across the 3 live Pharos Atlantic vaults — fees, gas and break-even enforced before any move is recommended."
                  />
                  <KpiRow snapshot={snapshot} result={result} />
                   <ScenarioChips activeId={activeScenario} onPick={pickScenario} />
                   <p className="mb-4 rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
                     Live state takes priority over bounty illustrations. Effective APY is the default;
                     target rates include modeled TVL dilution assuming fixed yield revenue. Base APY is exploratory.
                     Scenario badges are illustrative expectations, not promised outcomes. Hypothetical amounts
                     may be evaluated, but bundles are withheld when the inspected balance is insufficient.
                   </p>
                  <OptimizerControls input={input} onChange={(next) => {
                    setInput(next);
                    setActiveScenario(null);
                  }} disabled={false} />
                  <div className="mt-4">
                    <VerdictCard
                      result={result}
                      gasPriceGwei={snapshot.gasPriceGwei}
                      onPrepareBundle={scrollToBundle}
                      bundleBusy={false}
                    />
                  </div>
                </section>

                {/* ============ 2 · 3-Vault Yield Comparison ============ */}
                <section id="comparison">
                  <SectionHeader
                    title="3-Vault Yield Comparison"
                    description="RWA T-Bills, RWA Senior Private Credit and DeFi Instant Liquidity — live at one pinned block via Multicall3.aggregate3."
                  />
                  <VaultComparison snapshot={snapshot} result={result} />
                </section>

                {/* ============ 3 · Break-Even & Horizon Curve ============ */}
                <section id="breakeven">
                  <SectionHeader
                    title="Break-Even & Horizon Curve"
                    description="Switching costs (exit + entry + live gas) versus yield edge over time; moves must clear both break-even and the net-gain hurdle."
                  />
                  <BreakEvenChart result={result} />
                </section>

                {/* ============ 4 · Non-Custodial Tx Bundle ============ */}
                <section id="txbundle">
                  <SectionHeader
                    title="Non-Custodial Tx Bundle"
                    description="Unsigned EIP-155 payloads for your wallet's signature. No agent keys, server-side signing, or autonomous broadcasting."
                  />
                  <TxBundle
                    result={result}
                    snapshot={snapshot}
                    bundle={bundle}
                     walletAddress={snapshot.wallet?.address ?? address}
                    includeFirewall={includeFirewall}
                     onToggleFirewall={setIncludeFirewall}
                     receiptHash={receiptHash}
                     onReceiptHashChange={setReceiptHash}
                  />
                </section>

                {/* ============ 5 · Provenance & Airgap ============ */}
                <section id="provenance">
                  <SectionHeader
                    title="On-Chain Provenance & Airgap"
                    description="Every figure traces to its source contract, ABI function and pinned block height — plus the static non-custodial attestation."
                  />
                  <ProvenanceTable snapshot={snapshot} />
                </section>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-6 pb-2 text-[11px] text-muted-foreground">
                  <span>
                    ⚓ Pharos Apex — horizon-aware net-yield optimizer & non-custodial
                    rebalance desk. Every figure block-pinned; every transaction
                    user-signed.
                  </span>
                  <span className="font-mono">
                    audit:noncustodial · vitest · tsc --noEmit
                  </span>
                </footer>
              </div>
            )}
          </main>
      </div>
    </div>
  );
}
