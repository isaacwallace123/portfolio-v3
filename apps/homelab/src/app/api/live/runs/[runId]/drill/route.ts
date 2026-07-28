import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// POST   /api/live/runs/{runId}/drill — start a drill ON the caller's cluster. Body: { drillId }.
// DELETE /api/live/runs/{runId}/drill — end it; the cluster stays up as an open sandbox.
export const dynamic = "force-dynamic";

async function withTelemetry(
  runId: string,
  owner: string,
  payload: Record<string, unknown>,
) {
  let telemetry = null;
  try {
    const t = await liveFetch(`/v1/runs/${runId}/telemetry`, undefined, owner);
    if (t.ok) telemetry = await t.json();
  } catch {
    /* next poll */
  }
  return toLiveRunView({ ...payload, telemetry } as never);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  let body: { drillId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ error: "Expected JSON body." }, 400);
  }

  const res = await liveFetch(
    `/v1/runs/${runId}/drill`,
    {
      method: "POST",
      body: JSON.stringify({ drillId: String(body.drillId ?? "") }),
    },
    g.caller.owner,
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return jsonNoStore(payload, res.status);
  return jsonNoStore(await withTelemetry(runId, g.caller.owner, payload));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/drill`,
    { method: "DELETE" },
    g.caller.owner,
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return jsonNoStore(payload, res.status);
  return jsonNoStore(await withTelemetry(runId, g.caller.owner, payload));
}
