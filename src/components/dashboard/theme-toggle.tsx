"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Light/Dark switch (template header style, hydration-safe). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("apex-theme", next ? "dark" : "light");
    } catch {
      /* private mode — ignore */
    }
  }

  return (
     <Button
       aria-label="Toggle light / dark theme"
      variant="ghost"
      size="icon"
      className="rounded-full"
      onClick={toggle}
      title="Toggle light / dark theme"
    >
      {mounted && !dark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
