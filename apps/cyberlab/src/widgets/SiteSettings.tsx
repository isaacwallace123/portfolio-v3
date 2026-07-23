"use client";

import { useEffect, useState } from "react";
import { SectionHeader, Segmented, SettingRow } from "@iw/ui";
import {
  getPrefs,
  setPrefs,
  type CyberlabPrefs,
  type FeedDensity,
  type ReplaySpeed,
} from "@/shared/lib/prefs";

// The "This site" panel for the shared SettingsModal — cyberlab's genuinely site-specific prefs
// (localStorage, this subdomain only): activity-feed density and default replay speed. The universal
// cosmetics (theme, scale, motion, transparency) live in the Appearance tab. Passed to
// <SettingsModal siteTab={<SiteSettings/>} />.
export default function SiteSettings() {
  const [prefs, setLocal] = useState<CyberlabPrefs | null>(null);

  useEffect(() => {
    queueMicrotask(() => setLocal(getPrefs()));
  }, []);

  if (!prefs) return null;

  const patch = (p: Partial<CyberlabPrefs>) => setLocal(setPrefs(p));

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Console"
          description="Preferences unique to Cyberlab playback and live feeds."
        />

        <SettingRow
          title="Activity feed density"
          description="How tight the /live feed packs its rows."
        >
          <Segmented<FeedDensity>
            ariaLabel="Feed density"
            value={prefs.feedDensity}
            onChange={(feedDensity) => patch({ feedDensity })}
            options={[
              { value: "comfortable", label: "Cozy" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </SettingRow>

        <SettingRow
          title="Default replay speed"
          description="Where the case-study player starts."
        >
          <Segmented<ReplaySpeed>
            ariaLabel="Default replay speed"
            value={prefs.replaySpeed}
            onChange={(replaySpeed) => patch({ replaySpeed })}
            options={[
              { value: 0.5, label: "0.5×" },
              { value: 1, label: "1×" },
              { value: 2, label: "2×" },
              { value: 4, label: "4×" },
            ]}
          />
        </SettingRow>
      </section>

      <p className="text-[13px] leading-relaxed text-ink-dim">
        These two controls stay local to Cyberlab; appearance and accessibility
        follow the entire network.
      </p>
    </div>
  );
}
