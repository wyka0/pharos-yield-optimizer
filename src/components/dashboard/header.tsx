"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_WALLET, WALLET_PRESETS, isWellFormedAddress } from "@/lib/contracts";
import { Menu, Search } from "lucide-react";
import type { OptimizerSnapshot } from "@/lib/optimizer/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "./theme-toggle";
import { Badge } from "@/components/ui/badge";

/**
 * Apex sticky top bar, with a functional wallet search slot.
 * The hamburger glyph toggles the left navigation sidebar; the template's
 * search slot is wired to the Wallet Inspector.
 */
export function DashboardHeader({
  address,
  onAddressChange,
  sidebarOpen,
  onToggleSidebar,
  snapshot,
}: {
  address: string;
  onAddressChange: (addr: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  snapshot: OptimizerSnapshot | null;
}) {
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--apex-header-offset", `${header.getBoundingClientRect().height + 16}px`);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  function applyCustom() {
    const candidate = custom.trim();
    if (!isWellFormedAddress(candidate)) {
      setError("Invalid — expected a 0x… 20-byte hexadecimal address.");
      return;
    }
    setError(null);
    setCustom("");
    onAddressChange(candidate);
  }

  return (
    <header ref={headerRef} className="sticky top-0 z-30 border-b bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2">
        {/* Brand — hamburger glyph is the sidebar toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle navigation sidebar"
            aria-expanded={sidebarOpen}
            title={sidebarOpen ? "Collapse navigation" : "Open navigation"}
           className="cursor-pointer rounded-md p-2 transition-colors hover:bg-accent"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-medium">Rebalance Desk</span>
        </div>

        {/* Right: wallet inspector (template search slot) + theme switch */}
        <div className="ml-auto flex w-full items-center gap-2 md:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-80">
             <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
             <Input
               aria-label="Wallet address to inspect"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()}
              placeholder={`Inspect any 0x… wallet — currently ${address.slice(0, 10)}…${address.slice(-6)}`}
              className={`pl-8 font-mono text-xs ${error ? "border-destructive" : ""}`}
            />
          </div>
          <Button size="sm" onClick={applyCustom}>
            Inspect
          </Button>
          <ThemeToggle />
        </div>
      </div>

      {error && (
        <p className="px-4 pb-2 text-right text-xs font-medium text-destructive">
          {error}
        </p>
      )}
      <div data-testid="network-mode" className="border-t px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="max-w-full whitespace-normal">
            Pharos Atlantic Testnet #688689 [{snapshot && !snapshot.fromCache && snapshot.wallet && snapshot.wallet.address.toLowerCase() === address.toLowerCase()
              ? snapshot.vaults.some((v) => v.userAssetsSusdc > 0) ? "Live Funded Positions" : "No Funded Positions"
              : "Reading / Unverified Positions"}]
          </Badge>
          <Badge variant="secondary" className="max-w-full whitespace-normal">Mainnet-Ready ABI Engine [0 Balance Required]</Badge>
          <Button data-testid="inspect-funded-reference" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onAddressChange(WALLET_PRESETS[1].address)}>Inspect funded reference</Button>
          {address.toLowerCase() !== DEFAULT_WALLET.toLowerCase() && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onAddressChange(DEFAULT_WALLET)}>Reset inspector</Button>}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Live Atlantic reads · unsigned EIP-155 bundles · no agent/deployer Mainnet gas needed to read or prepare.
          Mainnet portability requires verified addresses &amp; chain configuration; user execution needs gas. Reference wallet is not assumed yours.
        </p>
      </div>
    </header>
  );
}
