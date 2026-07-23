export interface NetworkPreferences {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
}

export const DEFAULT_NETWORK_PREFERENCES: NetworkPreferences = {
  reduceMotion: false,
  reduceTransparency: false,
  highContrast: false,
};

export const NETWORK_PREFERENCES_COOKIE = "iw_accessibility";
const ONE_YEAR = 60 * 60 * 24 * 365;

function cookieDomainAttr(): string {
  if (typeof window === "undefined") return "";
  return window.location.hostname.endsWith("isaacwallace.dev")
    ? "; domain=.isaacwallace.dev"
    : "";
}

export function readNetworkPreferences(): NetworkPreferences {
  if (typeof document === "undefined") return DEFAULT_NETWORK_PREFERENCES;
  const match = document.cookie.match(
    /(?:^|;\s*)iw_accessibility=([01])([01])([01])(?:;|$)/,
  );
  if (!match) return DEFAULT_NETWORK_PREFERENCES;
  return {
    reduceMotion: match[1] === "1",
    reduceTransparency: match[2] === "1",
    highContrast: match[3] === "1",
  };
}

export function applyNetworkPreferences(
  preferences: NetworkPreferences = readNetworkPreferences(),
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.toggleAttribute("data-reduce-motion", preferences.reduceMotion);
  root.toggleAttribute(
    "data-reduce-transparency",
    preferences.reduceTransparency,
  );
  root.toggleAttribute("data-high-contrast", preferences.highContrast);
}

export function setNetworkPreferences(
  patch: Partial<NetworkPreferences>,
): NetworkPreferences {
  const next = { ...readNetworkPreferences(), ...patch };
  const encoded = `${Number(next.reduceMotion)}${Number(next.reduceTransparency)}${Number(next.highContrast)}`;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${NETWORK_PREFERENCES_COOKIE}=${encoded}; path=/; max-age=${ONE_YEAR}; samesite=lax${cookieDomainAttr()}${secure}`;
  applyNetworkPreferences(next);
  window.dispatchEvent(new CustomEvent("iw:preferences", { detail: next }));
  return next;
}

export const NETWORK_PREFERENCES_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${NETWORK_PREFERENCES_COOKIE}=([01])([01])([01])(?:;|$)/);if(!m)return;var r=document.documentElement;r.toggleAttribute('data-reduce-motion',m[1]==='1');r.toggleAttribute('data-reduce-transparency',m[2]==='1');r.toggleAttribute('data-high-contrast',m[3]==='1');}catch(e){}})();`;
