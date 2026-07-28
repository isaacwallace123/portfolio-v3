import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";

// GET /api/live/runs/{runId}/trace — latest sanitized OpenTelemetry trace from the caller's cluster.
//
// "No trace yet" is the normal state whenever traffic is off or the workload is still starting, so it
// answers 200 with null rather than 404. The page polls this every couple of seconds; a 404 would
// mean a stream of console errors for a condition that is not an error.
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/trace`,
    undefined,
    g.caller.owner,
  );
  if (!res.ok) return jsonNoStore(null);
  return jsonNoStore(await res.json().catch(() => null));
}
