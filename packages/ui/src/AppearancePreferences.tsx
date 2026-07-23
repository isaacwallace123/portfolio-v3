"use client";

import {
  AccessibilitySettings,
  type AccessibilityPrefs,
} from "./AccessibilitySettings";
import { AccentPicker, type AccentSwatch } from "./AccentPicker";
import { SectionHeader } from "./settings-ui";

export function AppearancePreferences({
  prefs,
  onPatch,
  onReset,
  accent,
}: {
  prefs: AccessibilityPrefs;
  onPatch: (patch: Partial<AccessibilityPrefs>) => void;
  onReset: () => void;
  accent?: {
    value: string | null;
    onChange: (value: string | null) => void;
    swatches: AccentSwatch[];
  };
}) {
  return (
    <div className="flex flex-col gap-6">
      {accent && (
        <section>
          <SectionHeader
            title="Accent colour"
            description="Choose a highlight or return to this site's default."
          />
          <AccentPicker
            value={accent.value}
            onChange={accent.onChange}
            swatches={accent.swatches}
          />
        </section>
      )}
      <AccessibilitySettings
        prefs={prefs}
        onPatch={onPatch}
        onReset={onReset}
      />
    </div>
  );
}
