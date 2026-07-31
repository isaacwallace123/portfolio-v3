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
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${RUNS_KEY}`);
  if (owner) headers.set("X-Owner-Key", owner);
  else headers.delete("X-Owner-Key");
  if (ownerName) headers.set("X-Owner-Name", ownerName);
  else headers.delete("X-Owner-Name");

  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        // Identifies which signed-in person owns the cluster. Resolved server-side from the SSO
        // session; the browser never supplies it, so it cannot be spoofed by a caller.
        // The name to put on the leaderboard, from the same verified session. Display only — nothing
        // is ever authorised by it, so the API can take it at face value for a row label.
        ...Object.fromEntries(headers.entries()),
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

// How long the API has to START answering a stream. A stream is then expected to stay open for
// minutes, so this deadline covers the handshake only — see below for why that distinction is the
// whole point of this function existing separately from liveFetch.
const UPSTREAM_STREAM_HEADERS_TIMEOUT_MS = 15_000;

/**
 * Call the HomeOps API for a response whose body is a long-lived stream.
 *
 * liveFetch cannot be used for this: its deadline aborts the whole request, body included, so an
 * event stream would be cut off mid-launch at the ten second mark. What actually needs a deadline
 * here is the handshake — an upstream that never answers at all — and once the response headers
 * arrive, staying open is the intended behaviour rather than a stall. So the timer is cancelled the
 * moment headers land, and from then on only the caller's own signal (the browser going away) ends
 * the request.
 */
export async function liveStream(
  path: string,
  signal: AbortSignal,
  owner?: string,
  ownerName?: string,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const handshake = setTimeout(
    () => controller.abort(),
    UPSTREAM_STREAM_HEADERS_TIMEOUT_MS,
  );

  const headers = new Headers();
  headers.set("Accept", "text/event-stream");
  headers.set("Authorization", `Bearer ${RUNS_KEY}`);
  if (owner) headers.set("X-Owner-Key", owner);
  if (ownerName) headers.set("X-Owner-Name", ownerName);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    return res;
  } catch {
    return Response.json(
      { error: "The homelab API is not responding right now." },
      { status: 504 },
    );
  } finally {
    clearTimeout(handshake);
  }
}
