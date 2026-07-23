export interface AiLabPrefs {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
}

export const DEFAULT_PREFS: AiLabPrefs = {
  reduceMotion: false,
  reduceTransparency: false,
  highContrast: false,
};

const KEY = "iw:ailab:prefs";

export function getPrefs(): AiLabPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefs(prefs: AiLabPrefs = getPrefs()): void {
  const root = document.documentElement;
  root.toggleAttribute("data-reduce-motion", prefs.reduceMotion);
  root.toggleAttribute("data-reduce-transparency", prefs.reduceTransparency);
  root.toggleAttribute("data-high-contrast", prefs.highContrast);
}

export function setPrefs(patch: Partial<AiLabPrefs>): AiLabPrefs {
  const next = { ...getPrefs(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The current page still receives the preference when storage is unavailable.
  }
  applyPrefs(next);
  return next;
}
