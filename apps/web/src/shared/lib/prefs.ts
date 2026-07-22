// Per-subdomain COSMETIC preferences — localStorage on this subdomain only, never the API.
// Identity (display name…) is the API's job; this file is for how *this* site behaves locally.

export interface WebPrefs {
  /** Force-reduce animation on this site (in addition to the OS setting). */
  reduceMotion: boolean;
}

const KEY = "iw:web:prefs";

const DEFAULTS: WebPrefs = {
  reduceMotion: false,
};

export function getPrefs(): WebPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setPrefs(patch: Partial<WebPrefs>): WebPrefs {
  const next = { ...getPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — prefs just don't persist */
  }
  applyPrefs(next);
  return next;
}

/** Reflect prefs onto <html> so CSS can react (html[data-reduce-motion]). */
export function applyPrefs(p: WebPrefs = getPrefs()): void {
  document.documentElement.toggleAttribute(
    "data-reduce-motion",
    p.reduceMotion,
  );
}

/** True when EITHER the OS or this site's preference asks for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.hasAttribute("data-reduce-motion")
  );
}
