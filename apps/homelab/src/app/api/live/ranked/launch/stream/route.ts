import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveStream } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";
// The whole point of this route is to hold a connection open and pass bytes through as they arrive.
export const fetchCache = "force-no-store";

/**
 * Server-sent events for a ranked launch: one connection that both starts the launch and reports
 * every phase it passes through, in place of the browser re-POSTing a state machine on a timer.
 *
 * This route is a pipe. The launch is driven upstream, next to the cluster it is provisioning, and
 * nothing here interprets or buffers the frames — reading the body to inspect it would defeat the
 * streaming this exists to provide.
 *
 * `start` is a write (it can provision a cluster), so it is guarded as one. The upstream call needs
 * `runs:write` either way, because advancing a launch is what this connection does.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get("start") === "true";
  const g = await guard(req, { kind: start ? "provision" : "stream" });
  if (!g.ok) return g.response;

  const upstream = new URLSearchParams();
  if (start) upstream.set("start", "true");
  if (url.searchParams.get("retry") === "true") upstream.set("retry", "true");
  const suffix = upstream.size > 0 ? `?${upstream}` : "";

  const res = await liveStream(
    `/v1/ranked/launch/stream${suffix}`,
    req.signal,
    g.caller.owner,
    g.caller.displayName,
  );

  // The launch refused before the stream began — no cluster in progress, no capacity, an incident
  // already on this one. Upstream deliberately answers those as ordinary statuses before it writes
  // a single frame, so they arrive here as JSON and are passed straight through.
  if (!res.ok || !res.body)
    return jsonNoStore(await res.json().catch(() => ({})), res.status);

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      // Nginx and friends buffer proxied responses by default, which would hold every frame until
      // the launch finished and deliver the whole sequence at once — the exact failure this route
      // is meant to avoid.
      "X-Accel-Buffering": "no",
      "X-Robots-Tag": "noindex",
    },
  });
}
