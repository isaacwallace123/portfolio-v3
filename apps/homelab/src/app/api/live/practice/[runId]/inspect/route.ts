import { guard, jsonNoStore, readBoundedStringBody } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

/**
 * One read-only investigation against the learner's own cluster.
 *
 * Guarded as an inspection like its ranked twin — the budget is about the cluster reads it fans out
 * into upstream, which are identical, not about whether the result is written down anywhere.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const g = await guard(req, { runId, kind: "inspect" });
  if (!g.ok) return g.response;

  const body = await readBoundedStringBody(req, "query", 128);
  if (!body.ok) return body.response;
  const res = await liveFetch(
    `/v1/practice/${runId}/inspect`,
    { method: "POST", body: JSON.stringify({ query: body.value }) },
    g.caller.owner,
    g.caller.displayName,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
