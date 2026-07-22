// Network-wide appearance (light / dark / system). The theme is SHARED across every
// *.isaacwallace.dev site: it rides a cookie on the parent domain (so switching on one site changes
// them all in this browser) and is mirrored to the account (so it follows you to a new device).

import { API_URL } from "./session";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_COOKIE = "iw_theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

// Prod: one cookie on .isaacwallace.dev covers every subdomain. Dev: plain localhost cookie
// (cookies ignore ports, so :3000/:3001/:3005 already share it) — no domain attribute.
function cookieDomainAttr(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.endsWith("isaacwallace.dev")
    ? "; domain=.isaacwallace.dev"
    : "";
}

export function readThemeChoice(): ThemeChoice {
  if (typeof document === "undefined") return "system";
  const m = document.cookie.match(/(?:^|;\s*)iw_theme=(light|dark|system)/);
  return (m?.[1] as ThemeChoice) ?? "system";
}

export function writeThemeCookie(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${ONE_YEAR}; samesite=lax${cookieDomainAttr()}${secure}`;
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return systemPrefersDark() ? "dark" : "light";
}

/** Reflect the choice onto <html>: data-theme = the CONCRETE theme the CSS keys off;
    data-theme-choice = the raw preference (so the picker can highlight "System"). */
export function applyTheme(
  choice: ThemeChoice = readThemeChoice(),
): ResolvedTheme {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeChoice = choice;
  return resolved;
}

/** Set the preference everywhere: cross-subdomain cookie + <html>, and (when signed in)
    persist to the account so it follows the user to other devices. */
export async function setThemeChoice(
  choice: ThemeChoice,
  { persist = true }: { persist?: boolean } = {},
): Promise<void> {
  writeThemeCookie(choice);
  applyTheme(choice);
  if (!persist) return;
  try {
    await fetch(`${API_URL}/auth/profile`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: choice }),
    });
  } catch {
    /* signed out or offline — the cookie still carries it across this browser */
  }
}

/** Adopt the account's saved theme when it differs from this browser's cookie (e.g. the first
    visit on a new device). Updates the cookie + <html>; no API write-back. */
export function adoptAccountTheme(accountTheme: ThemeChoice): void {
  if (accountTheme === readThemeChoice()) return;
  writeThemeCookie(accountTheme);
  applyTheme(accountTheme);
}

// Render-blocking snippet inlined into <head>: sets <html data-theme> from the cookie BEFORE the
// first paint so there's never a light/dark flash. Dependency-free — it's stringified into the page.
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)/);var c=m?m[1]:'system';var d=c==='dark'||(c!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=d?'dark':'light';r.dataset.themeChoice=c;}catch(e){}})();`;
