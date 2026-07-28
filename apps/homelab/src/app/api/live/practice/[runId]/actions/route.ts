import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// POST /api/live/practice/{runId}/actions — one allowlisted reconciliation of the caller's cluster.
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => ({}));
  const res = await liveFetch(
    `/v1/practice/${runId}/actions`,
    {
      method: "POST",
      body: JSON.stringify({ actionId: String(body.actionId ?? "") }),
    },
    g.caller.owner,
  );
  const payload = await res.json().catch(() => ({}));
  return jsonNoStore(res.ok ? toLiveRunView(payload) : payload, res.status);
}
