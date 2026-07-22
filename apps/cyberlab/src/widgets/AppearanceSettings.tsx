"use client";

import { useEffect, useState } from "react";
import { SettingRow, Toggle } from "@iw/ui";
import {
  DEFAULT_PREFS,
  getPrefs,
  setPrefs,
  type CyberlabPrefs,
} from "@/shared/lib/prefs";

// Cyberlab's cosmetic controls, shown in the shared SettingsModal's Appearance tab under the network
// theme. localStorage on this subdomain only. Deliberately NO accent picker — cyberlab's accent is
// the live actor story (it follows whoever is currently acting), so it stays owned by the site.
export default function AppearanceSettings() {
  const [prefs, setLocal] = useState<CyberlabPrefs | null>(null);

  useEffect(() => {
    setLocal(getPrefs());
  }, []);

  if (!prefs) return null;

  const patch = (p: Partial<CyberlabPrefs>) => setLocal(setPrefs(p));

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="font-mono text-[10px] font-bold tracking-[0.18em] text-ink-dim uppercase">
          Display & motion
        </div>

        <SettingRow
          title="Reduce motion"
          description="Kills animations here, on top of the OS setting."
        >
          <Toggle
            label="Reduce motion"
            checked={prefs.reduceMotion}
            onChange={(reduceMotion) => patch({ reduceMotion })}
          />
        </SettingRow>

        <SettingRow
          title="Reduce transparency"
          description="Turns off the frosted-glass blur for solid panels."
        >
          <Toggle
            label="Reduce transparency"
            checked={prefs.reduceTransparency}
            onChange={(reduceTransparency) => patch({ reduceTransparency })}
          />
        </SettingRow>

        <SettingRow
          title="High contrast"
          description="Stronger borders and text for legibility."
        >
          <Toggle
            label="High contrast"
            checked={prefs.highContrast}
            onChange={(highContrast) => patch({ highContrast })}
          />
        </SettingRow>
      </section>

      <div className="flex items-center justify-between">
        <p className="text-[13px] leading-relaxed text-ink-dim">
          Saved in this browser only — each site keeps its own look.
        </p>
        <button
          type="button"
          onClick={() => setLocal(setPrefs(DEFAULT_PREFS))}
          className="shrink-0 cursor-pointer rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
