import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";

// GET /api/live/runs/{runId}/events — real, sanitized Kubernetes Events from the caller's cluster.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/events`,
    undefined,
    g.caller.owner,
  );
  // A feed that is not ready yet must not break the page.
  if (!res.ok) return jsonNoStore([]);
  return jsonNoStore(await res.json().catch(() => []));
}
