"use client";

import { useEffect } from "react";
import {
  adoptAccountTheme,
  applyNetworkPreferences,
  applyTheme,
  getMe,
  readThemeChoice,
} from "@iw/core";

export function NetworkPreferencesBoot() {
  useEffect(() => {
    const refresh = () => {
      applyNetworkPreferences();
      applyTheme();
    };

    refresh();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readThemeChoice() === "system") applyTheme("system");
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    media.addEventListener("change", onSystemChange);
    window.addEventListener("focus", refresh);
    window.addEventListener("iw:preferences", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    getMe().then((user) => user && adoptAccountTheme(user.theme));

    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("iw:preferences", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
