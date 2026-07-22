"use client";

import { useEffect, useState } from "react";
import { readThemeChoice, setThemeChoice, type ThemeChoice } from "@iw/core";
import { THEME_ICON, THEME_ORDER } from "./theme-icons";

// The network-wide appearance control (Light / Dark / System), for a settings surface. Shared,
// not per-site: setThemeChoice writes the .isaacwallace.dev cookie (all sites, this browser) and —
// when signed in — the account (all your devices). Token-driven: it wears each app's palette via
// the design-contract CSS variables (surface / ink / brand).
export function ThemeControl({ signedIn }: { signedIn: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readThemeChoice()), []);

  const pick = (id: ThemeChoice) => {
    setChoice(id);
    void setThemeChoice(id);
  };

  return (
    <div>
      <div className="text-sm font-medium text-ink">Appearance</div>
      <div className="mt-0.5 text-xs text-ink-dim">
        Applies to every site in the network
        {signedIn ? ", and follows you across devices." : "."}
      </div>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="mt-2.5 grid grid-cols-3 gap-1 rounded-md border border-line bg-surface-2 p-1"
      >
        {THEME_ORDER.map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={choice === id}
            onClick={() => pick(id)}
            className={`flex h-(--ctl-sm) cursor-pointer items-center justify-center gap-1.5 rounded-[6px] text-[13px] font-semibold capitalize transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
              choice === id
                ? "bg-surface text-ink shadow-(--shadow-1)"
                : "text-ink-mid hover:text-ink"
            }`}
          >
            {THEME_ICON[id]}
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}
