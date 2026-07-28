import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";

// GET /api/live/runs/{runId}/components — per-tier, per-pod state of the caller's cluster
// (readiness, restarts, measured CPU/memory). Drives the request-path flowchart.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/components`,
    undefined,
    g.caller.owner,
  );
  if (!res.ok) return jsonNoStore([]);
  return jsonNoStore(await res.json().catch(() => []));
}
