"use client";

import { useEffect, useState } from "react";
import { readThemeChoice, setThemeChoice, type ThemeChoice } from "@iw/core";
import { THEME_ICON, THEME_ORDER } from "./theme-icons";

// A compact cycle button (Light → Dark → System) for a header/toolbar, where there's no settings
// modal. The choice still writes the shared cookie + account, so every site follows. Token-driven.
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readThemeChoice()), []);

  const next = () => {
    const n = THEME_ORDER[(THEME_ORDER.indexOf(choice) + 1) % THEME_ORDER.length];
    setChoice(n);
    void setThemeChoice(n);
  };

  return (
    <button
      onClick={next}
      aria-label={`Theme: ${choice}. Click to change.`}
      title={`Theme: ${choice}`}
      className={`grid size-9 cursor-pointer place-items-center rounded-md border border-line text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50 ${className}`}
    >
      {THEME_ICON[choice]}
    </button>
  );
}
