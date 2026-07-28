import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";
import { toLiveRunView } from "@/shared/api/live-view";

// GET /api/live/runs/{runId}/snapshot — one frame of the caller's cluster.
//
// The page polls this instead of five separate routes. Beyond the obvious round-trip saving, it
// keeps the poll inside the API's per-key rate window: five reads at a 1.2s tick is ~250 requests a
// minute against a fixed window, which used to empty part-way through every minute and leave the
// page failing for the remainder.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/snapshot`,
    undefined,
    g.caller.owner,
  );
  if (!res.ok) {
    return jsonNoStore(await res.json().catch(() => ({})), res.status);
  }

  const snap = (await res.json()) as {
    run: Record<string, unknown>;
    telemetry: unknown;
    components: unknown;
    events: unknown;
    trace: unknown;
  };

  return jsonNoStore({
    run: toLiveRunView({ ...snap.run, telemetry: snap.telemetry } as never),
    components: snap.components ?? [],
    events: snap.events ?? [],
    trace: snap.trace ?? null,
  });
}
