import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// POST /api/live/runs/{runId}/decisions — apply an allowlisted operator decision. Body: { decisionId }.
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  let body: { decisionId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ error: "Expected JSON body." }, 400);
  }

  const res = await liveFetch(
    `/v1/runs/${runId}/decisions`,
    {
      method: "POST",
      body: JSON.stringify({ decisionId: String(body.decisionId ?? "") }),
    },
    g.caller.owner,
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return jsonNoStore(payload, res.status);

  let telemetry = null;
  try {
    const t = await liveFetch(
      `/v1/runs/${runId}/telemetry`,
      undefined,
      g.caller.owner,
    );
    if (t.ok) telemetry = await t.json();
  } catch {
    /* next poll */
  }
  return jsonNoStore(toLiveRunView({ ...payload, telemetry }));
}
