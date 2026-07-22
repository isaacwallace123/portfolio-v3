// Per-subdomain COSMETIC preferences — localStorage on this subdomain only, never the API.
// Identity (display name…) is the API's job; this file is for how *this* site behaves locally.

export interface WebPrefs {
  /** Force-reduce animation on this site (in addition to the OS setting). */
  reduceMotion: boolean;
  /** Disable glass/blur effects — opaque chrome, no backdrop-filter. */
  reduceTransparency: boolean;
  /** Stronger borders and text for legibility. */
  highContrast: boolean;
  /** Personal accent override (hex) for this browser, or null to follow the site default. */
  accent: string | null;
}

/** Baseline cosmetic prefs — also used by the settings modal's "Reset to defaults". */
export const DEFAULT_PREFS: WebPrefs = {
  reduceMotion: false,
  reduceTransparency: false,
  highContrast: false,
  accent: null,
};

const KEY = "iw:web:prefs";

const DEFAULTS = DEFAULT_PREFS;

/** Curated accent choices offered in the settings modal — chosen to read on both paper and dusk. */
export const ACCENT_SWATCHES: Array<{ name: string; hex: string }> = [
  { name: "Indigo", hex: "#4f66e0" },
  { name: "Teal", hex: "#0e9aa7" },
  { name: "Violet", hex: "#7c5cff" },
  { name: "Emerald", hex: "#12a26b" },
  { name: "Rose", hex: "#e0526f" },
  { name: "Amber", hex: "#d98324" },
];

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

/** Reflect prefs onto <html> so CSS (and the accent variable) can react. */
export function applyPrefs(p: WebPrefs = getPrefs()): void {
  const root = document.documentElement;
  root.toggleAttribute("data-reduce-motion", p.reduceMotion);
  root.toggleAttribute("data-reduce-transparency", p.reduceTransparency);
  root.toggleAttribute("data-high-contrast", p.highContrast);
  // The accent override wins over both :root palettes via inline priority; clearing it restores
  // the theme's native accent (indigo on paper, lifted indigo on dusk).
  if (p.accent) {
    root.style.setProperty("--accent", p.accent);
  } else {
    root.style.removeProperty("--accent");
  }
}

/** True when EITHER the OS or this site's preference asks for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.hasAttribute("data-reduce-motion")
  );
}
