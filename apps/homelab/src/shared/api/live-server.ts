// Server-only bridge from the public homelab page to the real HomeOps API (api.isaacwallace.dev).
import "server-only";
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

// A request that never answers is worse than one that fails: without a deadline a stalled upstream
// pins a server worker for as long as the socket stays open, and enough of them take the page down
// while the cluster itself is fine. Long enough for a real cluster read, short enough to give up.
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Call the HomeOps API with the scoped key attached.
 *
 * Never throws on a transport failure: an unreachable or stalled API comes back as a synthetic 504
 * so every caller keeps its one shape — check `res.ok`, read the body — instead of half of them
 * needing a try/catch to avoid turning a bad minute upstream into a 500 on the page.
 */
export async function liveFetch(
  path: string,
  init?: RequestInit,
  owner?: string,
  ownerName?: string,
): Promise<Response> {
  // A caller's own signal is added to the deadline, never substituted for it. Falling back with
  // `??` would mean any route that passed one — forwarding `req.signal` to cancel work when the
  // browser goes away is the obvious thing to reach for — silently opted out of the timeout, which
  // is the exact failure this is here to prevent.
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;

  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNS_KEY}`,
        // Identifies which signed-in person owns the cluster. Resolved server-side from the SSO
        // session; the browser never supplies it, so it cannot be spoofed by a caller.
        ...(owner ? { "X-Owner-Key": owner } : {}),
        // The name to put on the leaderboard, from the same verified session. Display only — nothing
        // is ever authorised by it, so the API can take it at face value for a row label.
        ...(ownerName ? { "X-Owner-Name": ownerName } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    // The reason is deliberately not forwarded: upstream hostnames and connection errors are
    // operator detail, and the page can do nothing differently with them.
    return Response.json(
      { error: "The homelab API is not responding right now." },
      { status: 504 },
    );
  }
}
