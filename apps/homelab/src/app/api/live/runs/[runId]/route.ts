import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";
import { toLiveRunView } from "@/shared/api/live-view";

// GET    /api/live/runs/{runId} — the caller's cluster, merged with its live telemetry.
// DELETE /api/live/runs/{runId} — tear the caller's cluster down.
// The API answers 404 for a cluster the caller does not own, so ids cannot be probed.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const runRes = await liveFetch(
    `/v1/runs/${runId}`,
    undefined,
    g.caller.owner,
  );
  const run = await runRes.json().catch(() => ({}));
  if (!runRes.ok) return jsonNoStore(run, runRes.status);

  let telemetry = null;
  try {
    const t = await liveFetch(
      `/v1/runs/${runId}/telemetry`,
      undefined,
      g.caller.owner,
    );
    if (t.ok) telemetry = await t.json();
  } catch {
    /* the next poll fills it in */
  }
  return jsonNoStore(toLiveRunView({ ...run, telemetry }));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}`,
    { method: "DELETE" },
    g.caller.owner,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
