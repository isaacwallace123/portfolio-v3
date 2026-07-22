"use client";

import { useEffect } from "react";
import { applyTheme, readThemeChoice } from "@iw/core";

// Re-asserts the shared theme on mount and keeps "system" live if the OS flips. The first paint is
// already handled by the inline script in <head>; account reconciliation happens in AdminGate
// (which already fetches /auth/me). Admin has no localStorage cosmetics, so this is theme-only.
export default function ThemeBoot() {
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readThemeChoice() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);
  return null;
}
