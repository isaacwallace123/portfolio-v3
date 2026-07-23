"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_NETWORK_PREFERENCES,
  readNetworkPreferences,
  setNetworkPreferences,
  type NetworkPreferences,
} from "@iw/core";
import { AccessibilitySettings } from "./AccessibilitySettings";

export function NetworkAccessibilitySettings() {
  const [preferences, setPreferences] = useState<NetworkPreferences>(
    DEFAULT_NETWORK_PREFERENCES,
  );

  useEffect(() => {
    const refresh = () => setPreferences(readNetworkPreferences());
    refresh();
    window.addEventListener("iw:preferences", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("iw:preferences", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const patch = (next: Partial<NetworkPreferences>) => {
    setPreferences(setNetworkPreferences(next));
  };

  return (
    <AccessibilitySettings
      prefs={preferences}
      onPatch={patch}
      onReset={() =>
        setPreferences(setNetworkPreferences(DEFAULT_NETWORK_PREFERENCES))
      }
    />
  );
}
