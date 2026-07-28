import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/runs/{runId}/report — after-action report for the caller's completed drill.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/report`,
    undefined,
    g.caller.owner,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
