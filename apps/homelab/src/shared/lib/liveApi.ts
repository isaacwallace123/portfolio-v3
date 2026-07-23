// Server-only bridge from the public homelab page to the real HomeOps API (api.isaacwallace.dev).
//
// The browser never holds a cluster credential or an API key: it calls this app's /api/live/* routes
// same-origin, and those routes (server-side) forward to the real API with a scoped runs:write key
// held only in server env. A random visitor can therefore provision a run, but only the one bounded,
// sandboxed, TTL'd, capacity-gated scenario the API allows — the isolation model assumes exactly this.

const API_BASE = process.env.HOMELAB_API_URL ?? "https://api.isaacwallace.dev";
const RUNS_KEY = process.env.HOMELAB_RUNS_KEY ?? "";

// Live provisioning is only offered when a key is configured; otherwise the page shows a disabled
// state instead of erroring.
export function liveEnabled(): boolean {
  return RUNS_KEY.length > 0;
}

export async function liveFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNS_KEY}`,
      ...init?.headers,
    },
    cache: "no-store",
  });
}
