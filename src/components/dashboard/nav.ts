"use client";

import { useEffect, useState } from "react";

/** Pharos Apex sections, in scroll order. */
export const NAV_SECTIONS = [
  { id: "optimizer", label: "Optimizer & Verdict", icon: "target" as const },
  { id: "comparison", label: "3-Vault Yield Comparison", icon: "vault" as const },
  { id: "breakeven", label: "Break-Even & Horizon Curve", icon: "trend" as const },
  { id: "txbundle", label: "Non-Custodial Tx Bundle", icon: "wallet" as const },
  { id: "provenance", label: "On-Chain Provenance & Airgap", icon: "link" as const },
];

/**
 * Tracks which section is currently in view (scroll-anchored nav).
 * `ready` must flip true once the section elements are actually mounted —
 * on first paint the page shows a loading skeleton, so observing eagerly
 * would find zero elements and the highlight would never move.
 */
export function useActiveSection(ready = true): string {
  const [active, setActive] = useState("optimizer");

  useEffect(() => {
    if (!ready) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    for (const s of NAV_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ready]);

  return active;
}
