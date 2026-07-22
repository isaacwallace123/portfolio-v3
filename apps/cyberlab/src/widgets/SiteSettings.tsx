"use client";

import { useEffect, useState } from "react";
import {
  getPrefs,
  setPrefs,
  type CyberlabPrefs,
  type FeedDensity,
  type ReplaySpeed,
} from "@/shared/lib/prefs";

// The "This site" panel for the shared SettingsModal — cyberlab's cosmetic prefs (localStorage,
// this subdomain only): reduce motion, feed density, default replay speed. Passed to
// <SettingsModal siteTab={<SiteSettings/>} />.
export default function SiteSettings() {
  const [prefs, setLocal] = useState<CyberlabPrefs | null>(null);

  useEffect(() => {
    setLocal(getPrefs());
  }, []);

  const patch = (p: Partial<CyberlabPrefs>) => setLocal(setPrefs(p));

  const segBtn = (active: boolean) =>
    `h-(--ctl-sm) cursor-pointer px-3 font-mono text-xs transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
      active
        ? "bg-[color-mix(in_srgb,var(--accent)_24%,var(--panel))] font-bold text-[color-mix(in_srgb,var(--accent)_92%,#fff)]"
        : "bg-panel text-ink-mid hover:text-ink"
    }`;

  if (!prefs) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-ink">Reduce motion</div>
          <div className="text-xs text-ink-dim">
            Kills animations here, on top of the OS setting.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={prefs.reduceMotion}
          aria-label="Reduce motion"
          onClick={() => patch({ reduceMotion: !prefs.reduceMotion })}
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-(--dur-base) outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
            prefs.reduceMotion ? "bg-primary" : "bg-line"
          }`}
        >
          <span
            aria-hidden
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-ink transition-transform duration-(--dur-base) ease-(--ease-spring) ${
              prefs.reduceMotion ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-ink">Activity feed density</div>
          <div className="text-xs text-ink-dim">
            How tight the /live feed packs its rows.
          </div>
        </div>
        <div
          role="group"
          aria-label="Feed density"
          className="flex overflow-hidden rounded-md border border-line"
        >
          {(["comfortable", "compact"] as FeedDensity[]).map((d) => (
            <button
              key={d}
              aria-pressed={prefs.feedDensity === d}
              onClick={() => patch({ feedDensity: d })}
              className={segBtn(prefs.feedDensity === d)}
            >
              {d === "comfortable" ? "Cozy" : "Compact"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-ink">Default replay speed</div>
          <div className="text-xs text-ink-dim">
            Where the case-study player starts.
          </div>
        </div>
        <div
          role="group"
          aria-label="Default replay speed"
          className="flex overflow-hidden rounded-md border border-line"
        >
          {([0.5, 1, 2, 4] as ReplaySpeed[]).map((s) => (
            <button
              key={s}
              aria-pressed={prefs.replaySpeed === s}
              onClick={() => patch({ replaySpeed: s })}
              className={segBtn(prefs.replaySpeed === s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-dim">
        Stored in this browser only — each site in the network keeps its own
        cosmetic preferences.
      </p>
    </div>
  );
}
