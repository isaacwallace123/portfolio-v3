"use client";

import { useEffect, useState } from "react";
import { getPrefs, setPrefs, type WebPrefs } from "@/shared/lib/prefs";

// The "This site" panel for the shared SettingsModal — cosmetic prefs stored in localStorage on
// this subdomain only. Passed to <SettingsModal siteTab={<SiteSettings/>} />.
export default function SiteSettings() {
  const [prefs, setLocal] = useState<WebPrefs | null>(null);

  useEffect(() => {
    setLocal(getPrefs());
  }, []);

  if (!prefs) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm">Reduce motion</div>
          <div className="text-xs text-ink-dim">
            Kills animations here, on top of the OS setting.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={prefs.reduceMotion}
          aria-label="Reduce motion"
          onClick={() =>
            setLocal(setPrefs({ reduceMotion: !prefs.reduceMotion }))
          }
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-(--dur-base) outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            prefs.reduceMotion ? "bg-accent" : "bg-line-2"
          }`}
        >
          <span
            aria-hidden
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-card shadow-(--shadow-1) transition-transform duration-(--dur-base) ease-(--ease-spring) ${
              prefs.reduceMotion ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-dim">
        Stored in this browser only — each site in the network keeps its own
        cosmetic preferences.
      </p>
    </div>
  );
}
