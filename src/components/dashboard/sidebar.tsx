"use client";

import {
  Crosshair,
  Layers,
  TrendingUp,
  Wallet,
  Link2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  PHAROS_CHAIN_ID,
  PHAROS_RPC_URL,
  PHAROS_EXPLORER_URL,
} from "@/lib/contracts";
import type { OptimizerSnapshot } from "@/lib/optimizer/types";
import { Badge } from "@/components/ui/badge";
import { BlockBadgeLink } from "./bits";
import { NAV_SECTIONS, useActiveSection } from "./nav";

const ICONS: Record<string, LucideIcon> = {
  target: Crosshair,
  vault: Layers,
  trend: TrendingUp,
  wallet: Wallet,
  link: Link2,
};

/**
 * Pharos Apex left navigation sidebar, toggled by the header hamburger.
 * Desktop (lg+): fixed 288px Apex column, open by default.
 * Mobile: fixed overlay drawer with a backdrop; navigating or tapping the
 * backdrop closes it.
 */
export function DashboardSidebar({
  snapshot,
  open,
  onClose,
}: {
  snapshot: OptimizerSnapshot | null;
  open: boolean;
  onClose: () => void;
}) {
  // Sections mount only after the snapshot arrives (skeleton before that) —
  // the observer must (re)attach once they exist for the highlight to move.
  const active = useActiveSection(snapshot !== null);

  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop — tap to dismiss */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-background">
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
            <span className="text-lg font-semibold">Pharos Apex</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation sidebar"
              className="cursor-pointer rounded-md p-1 transition-colors hover:bg-accent lg:hidden"
            >
              <X className="size-4" />
            </button>
          </div>
        <div className="flex-1 overflow-auto py-2">
        <nav className="grid gap-1 px-2">
          {NAV_SECTIONS.map((section) => {
            const Icon = ICONS[section.icon];
            return (
              <a
                key={section.id}
                 href={`#${section.id}`}
                 aria-current={active === section.id ? "location" : undefined}
                onClick={(e) => {
                  // Explicit navigation: scrollIntoView honors scroll-margin-top
                  // and avoids the anchor-jump/drawer-unmount race at mobile widths.
                  e.preventDefault();
                  document
                    .getElementById(section.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  history.replaceState(null, "", `#${section.id}`);
                  if (window.matchMedia("(max-width: 1023px)").matches) {
                    onClose();
                  }
                }}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active === section.id
                    ? "bg-[var(--color-accent)] text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="size-5 shrink-0" />
                {section.label}
              </a>
            );
          })}
        </nav>

        {/* Live chain status */}
        <div className="mt-6 border-t p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Network
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Chain</span>
              <Badge variant="accent">#{PHAROS_CHAIN_ID}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Pinned</span>
              {snapshot ? (
                <BlockBadgeLink blockNumber={snapshot.blockNumber} />
              ) : (
                <span className="text-xs text-muted-foreground">…</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Batching</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                Multicall3
              </span>
            </div>
          </div>
          <p className="mt-3 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
            {PHAROS_RPC_URL}
          </p>
          <a
            href={PHAROS_EXPLORER_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
          >
            atlantic.pharosscan.xyz ↗
          </a>
        </div>

        </div>
        {/* Non-custodial attestation, matching template footer divider. */}
        <div className="border-t p-4">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-[var(--color-positive)]" />
            <p className="text-[11px] font-semibold uppercase tracking-wider">
              Strictly Non-Custodial
            </p>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>agent never holds private keys</li>
            <li>unsigned payloads only — you sign</li>
            <li>STAY_PUT ⇒ zero fund-moving steps</li>
            <li>
              attested by <code className="font-mono text-[10px]">npm run audit:noncustodial</code>
            </li>
          </ul>
        </div>
      </aside>
    </>
  );
}
