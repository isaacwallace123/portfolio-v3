"use client";

import { useEffect } from "react";
import {
  adoptAccountTheme,
  applyTheme,
  getMe,
  readThemeChoice,
} from "@iw/core";
import { applyPrefs } from "@/shared/lib/prefs";

// Applies stored client-side preferences on mount: cosmetic prefs (reduce-motion, feed density…)
// plus the shared theme — re-asserted from the cookie, kept live if "system" flips, and reconciled
// with the account. The first paint's theme is already set by the inline script in <head>.
export default function PrefsBoot() {
  useEffect(() => {
    applyPrefs();
    applyTheme();

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readThemeChoice() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystemChange);

    getMe().then((u) => u && adoptAccountTheme(u.theme));

    return () => mq.removeEventListener("change", onSystemChange);
  }, []);
  return null;
}
