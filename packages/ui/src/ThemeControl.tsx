"use client";

import { useEffect, useState } from "react";
import { readThemeChoice, setThemeChoice, type ThemeChoice } from "@iw/core";
import { THEME_ICON, THEME_ORDER } from "./theme-icons";

// The network-wide appearance control (Light / Dark / System). Rendered as preview cards — each a
// little window mockup painted in that theme's colours, so you can see what you'll get — instead of
// a plain toggle. Shared, not per-site: setThemeChoice writes the .isaacwallace.dev cookie (all
// sites, this browser) and — when signed in — the account (all your devices). The accent bar in each
// preview uses the app's live accent (var(--accent)), so it wears each app's palette.

type Palette = { bg: string; bar: string; rail: string; line: string };

// Representative network palettes (the editorial light/dark grounds), just for the previews.
const LIGHT: Palette = {
  bg: "#faf9f6",
  bar: "#efece4",
  rail: "#e4e1d8",
  line: "#d8d4c9",
};
const DARK: Palette = {
  bg: "#101218",
  bar: "#191c24",
  rail: "#1e222b",
  line: "#2a2e39",
};

function Mockup({ p }: { p: Palette }) {
  return (
    <div className="flex h-full w-full flex-col" style={{ background: p.bg }}>
      <div
        className="flex h-2.5 items-center gap-1 px-1.5"
        style={{ background: p.bar }}
      >
        <span
          className="size-1 rounded-full"
          style={{ background: "var(--accent)" }}
        />
        <span className="size-1 rounded-full" style={{ background: p.line }} />
      </div>
      <div className="flex flex-1">
        <div className="w-3" style={{ background: p.rail }} />
        <div className="flex flex-1 flex-col gap-1 p-1.5">
          <span
            className="h-1 w-2/3 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          <span
            className="h-1 w-full rounded-full"
            style={{ background: p.line }}
          />
          <span
            className="h-1 w-4/5 rounded-full"
            style={{ background: p.line }}
          />
        </div>
      </div>
    </div>
  );
}

const PREVIEW: Record<ThemeChoice, React.ReactNode> = {
  light: <Mockup p={LIGHT} />,
  dark: <Mockup p={DARK} />,
  // System: light top-left, dark bottom-right — split diagonally.
  system: (
    <div className="relative h-full w-full">
      <Mockup p={LIGHT} />
      <div
        className="absolute inset-0"
        style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      >
        <Mockup p={DARK} />
      </div>
    </div>
  ),
};

export function ThemeControl({ signedIn }: { signedIn: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readThemeChoice()), []);

  const pick = (id: ThemeChoice) => {
    setChoice(id);
    void setThemeChoice(id);
  };

  return (
    <div>
      <div className="text-sm font-medium text-ink">Theme</div>
      <div className="mt-0.5 text-xs text-ink-dim">
        Light or dark, across every site in the network
        {signedIn ? " — follows you across devices." : "."}
      </div>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="mt-2.5 grid grid-cols-3 gap-2.5"
      >
        {THEME_ORDER.map((id) => {
          const active = choice === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={active}
              onClick={() => pick(id)}
              className="group cursor-pointer text-left outline-none"
            >
              <div
                className={`aspect-[4/3] w-full overflow-hidden rounded-lg border-2 transition-colors duration-(--dur-fast) group-focus-visible:ring-2 group-focus-visible:ring-brand/50 ${
                  active
                    ? "border-brand"
                    : "border-line group-hover:border-line-2"
                }`}
              >
                {PREVIEW[id]}
              </div>
              <div
                className={`mt-1.5 flex items-center justify-center gap-1.5 text-[13px] capitalize transition-colors duration-(--dur-fast) ${
                  active
                    ? "font-semibold text-ink"
                    : "text-ink-mid group-hover:text-ink"
                }`}
              >
                <span aria-hidden className="[&_svg]:size-3.5">
                  {THEME_ICON[id]}
                </span>
                {id}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
