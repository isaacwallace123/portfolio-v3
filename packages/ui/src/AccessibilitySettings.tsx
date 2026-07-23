"use client";

import { SectionHeader, SettingRow, Toggle } from "./settings-ui";

export interface AccessibilityPrefs {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
}

export function AccessibilitySettings({
  prefs,
  onPatch,
  onReset,
}: {
  prefs: AccessibilityPrefs;
  onPatch: (patch: Partial<AccessibilityPrefs>) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Display & motion"
          description="Tune animation, transparency, and contrast for this browser."
        />
        <SettingRow
          title="Reduce motion"
          description="Disables nonessential animation in addition to your OS preference."
        >
          <Toggle
            label="Reduce motion"
            checked={prefs.reduceMotion}
            onChange={(reduceMotion) => onPatch({ reduceMotion })}
          />
        </SettingRow>
        <SettingRow
          title="Reduce transparency"
          description="Replaces frosted glass with solid surfaces."
        >
          <Toggle
            label="Reduce transparency"
            checked={prefs.reduceTransparency}
            onChange={(reduceTransparency) => onPatch({ reduceTransparency })}
          />
        </SettingRow>
        <SettingRow
          title="High contrast"
          description="Strengthens borders and secondary text in either theme."
        >
          <Toggle
            label="High contrast"
            checked={prefs.highContrast}
            onChange={(highContrast) => onPatch({ highContrast })}
          />
        </SettingRow>
      </section>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] leading-relaxed text-ink-dim">
          Shared across every site in this browser.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="h-(--ctl-sm) shrink-0 cursor-pointer rounded-md border border-line px-3 text-[12px] font-semibold text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
