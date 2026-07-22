// The shared session/auth client for the whole isaacwallace.dev network. Every site reads the same
// session cookie on the parent domain; sign-in itself happens on the identity portal
// (auth.isaacwallace.dev). This is the single source of truth — apps import it from "@iw/core"
// instead of keeping per-app copies. NEXT_PUBLIC_* are inlined per app at build time (the package is
// transpiled by each app's Next build via transpilePackages), so the URLs resolve per site.

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  /** Network-wide appearance preference — see theme.ts. */
  theme: "light" | "dark" | "system";
  roles: string[];
}

export interface AuthProviders {
  providers: string[];
  devLogin: boolean;
}

/** One signed-in device/browser. Revoking a non-current one kills it network-wide, immediately. */
export interface SessionInfo {
  id: string;
  createdUtc: string;
  lastSeenUtc: string;
  userAgent: string;
  ip: string;
  current: boolean;
}

const isDev = process.env.NODE_ENV === "development";

/** The general application API (non-auth data). Its own service on :5180 in dev. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (isDev ? "http://localhost:5180" : "https://api.isaacwallace.dev");

/** The dedicated auth service — sign-in, sessions, roles, and the SSO cookie. Its own .NET service
    and domain: auth.isaacwallace.dev in prod (path-routed alongside the portal), :5170 in dev. */
export const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  (isDev ? "http://localhost:5170" : "https://auth.isaacwallace.dev");

/** The identity portal (sign-in UI). auth.isaacwallace.dev in prod, :3005 in dev. */
export const AUTH_URL =
  process.env.NEXT_PUBLIC_AUTH_URL ??
  (isDev ? "http://localhost:3005" : "https://auth.isaacwallace.dev");

export const ADMIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL ??
  (isDev ? "http://localhost:3004" : "https://admin.isaacwallace.dev");

export const HOME_URL =
  process.env.NEXT_PUBLIC_HOME_URL ??
  (isDev ? "http://localhost:3000" : "https://isaacwallace.dev");

/** The shared fetch wrapper — cookie-credentialed, JSON, throws on !ok. `base` selects the service. */
async function request<T>(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      (body as { error?: string }).error ?? `Request failed (${res.status})`,
    );
  return body as T;
}

/** Call the general application API (api.isaacwallace.dev). Exported so apps can build their own
    data endpoints on it. */
export const api = <T>(path: string, init?: RequestInit): Promise<T> =>
  request<T>(API_URL, path, init);

/** Call the dedicated auth service (auth.isaacwallace.dev) — sign-in, sessions, roles. Exported so
    the admin console can build its user/role management on it. */
export const authApi = <T>(path: string, init?: RequestInit): Promise<T> =>
  request<T>(AUTH_API_URL, path, init);

/** The signed-in user, or null. Never throws on 401. */
export async function getMe(): Promise<SessionUser | null> {
  try {
    return await authApi<SessionUser>("/auth/me");
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await authApi("/auth/logout", { method: "POST" });
}

/** Update the shared display name — the one identity setting editable in-app. */
export function updateProfile(displayName: string): Promise<SessionUser> {
  return authApi<SessionUser>("/auth/profile", {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

// ── Sign-in surface (used by the identity portal) ───────────────────────────
export function getProviders(): Promise<AuthProviders> {
  return authApi<AuthProviders>("/auth/providers");
}

/** Start the OAuth flow at the auth service, returning to `returnTo` when done. */
export function providerLoginUrl(provider: string, returnTo: string): string {
  return `${AUTH_API_URL}/auth/login/${provider.toLowerCase()}?returnUrl=${encodeURIComponent(returnTo)}`;
}

export function devLogin(
  email: string,
  displayName?: string,
): Promise<SessionUser> {
  return authApi<SessionUser>("/auth/dev-login", {
    method: "POST",
    body: JSON.stringify({ email, displayName }),
  });
}

// ── Sessions: your signed-in devices, revocable network-wide ────────────────
export function getSessions(): Promise<SessionInfo[]> {
  return authApi<SessionInfo[]>("/auth/sessions");
}

export function revokeSession(
  id: string,
): Promise<{ ok: boolean; current: boolean }> {
  return authApi(`/auth/sessions/${id}`, { method: "DELETE" });
}

export function revokeOtherSessions(): Promise<{ ok: boolean; revoked: number }> {
  return authApi("/auth/sessions/revoke-others", { method: "POST" });
}

/** "Chrome · Windows"-style label from a raw User-Agent — heuristic, for display only. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox/")
      ? "Firefox"
      : ua.includes("chrome/")
        ? "Chrome"
        : ua.includes("safari/")
          ? "Safari"
          : userAgent
            ? "Browser"
            : "Unknown client";
  const os = ua.includes("windows")
    ? "Windows"
    : ua.includes("mac os") || ua.includes("macintosh")
      ? "macOS"
      : ua.includes("android")
        ? "Android"
        : ua.includes("iphone") || ua.includes("ipad")
          ? "iOS"
          : ua.includes("linux")
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Only allow bouncing back to a site on the network — never an arbitrary URL. */
export function safeReturn(raw: string | null | undefined): string {
  if (!raw) return HOME_URL;
  try {
    const url = new URL(raw, HOME_URL);
    const ok =
      url.hostname === "localhost" ||
      url.hostname === "isaacwallace.dev" ||
      url.hostname.endsWith(".isaacwallace.dev");
    return ok ? url.toString() : HOME_URL;
  } catch {
    return HOME_URL;
  }
}

/** Where an app should send the user to sign in, returning here afterwards. */
export function loginHref(returnTo: string): string {
  return `${AUTH_URL}/login?returnUrl=${encodeURIComponent(returnTo)}`;
}
