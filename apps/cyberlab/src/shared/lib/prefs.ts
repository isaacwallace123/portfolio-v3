// Per-subdomain COSMETIC preferences — localStorage on this subdomain only, never the API.
// Identity (display name…) is the API's job; this file is for how *this* site behaves locally.
// Note: there's deliberately no accent override here — cyberlab's accent is the live actor story
// (it follows whoever is currently acting), so it stays owned by the site, not the visitor.

export type FeedDensity = "comfortable" | "compact";
export type ReplaySpeed = 0.5 | 1 | 2 | 4;

export interface CyberlabPrefs {
  /** Force-reduce animation on this site (in addition to the OS setting). */
  reduceMotion: boolean;
  /** Disable glass/blur effects — opaque chrome, no backdrop-filter. */
  reduceTransparency: boolean;
  /** Stronger borders and text for legibility. */
  highContrast: boolean;
  /** Activity feed density on /live. */
  feedDensity: FeedDensity;
  /** Default speed multiplier the scenario player starts at. */
  replaySpeed: ReplaySpeed;
}

const KEY = "iw:cyberlab:prefs";

/** Baseline cosmetic prefs — also used by the settings modal's "Reset to defaults". */
export const DEFAULT_PREFS: CyberlabPrefs = {
  reduceMotion: false,
  reduceTransparency: false,
  highContrast: false,
  feedDensity: "comfortable",
  replaySpeed: 1,
};

const DEFAULTS = DEFAULT_PREFS;

export function getPrefs(): CyberlabPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setPrefs(patch: Partial<CyberlabPrefs>): CyberlabPrefs {
  const next = { ...getPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — prefs just don't persist */
  }
  applyPrefs(next);
  return next;
}

/** Reflect prefs onto <html> so CSS can react. */
export function applyPrefs(p: CyberlabPrefs = getPrefs()): void {
  const root = document.documentElement;
  root.toggleAttribute("data-reduce-motion", p.reduceMotion);
  root.toggleAttribute("data-reduce-transparency", p.reduceTransparency);
  root.toggleAttribute("data-high-contrast", p.highContrast);
}

/** True when EITHER the OS or this site's preference asks for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.hasAttribute("data-reduce-motion")
  );
}
