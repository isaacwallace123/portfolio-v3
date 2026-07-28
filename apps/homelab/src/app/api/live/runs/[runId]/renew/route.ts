import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";
import { toLiveRunView } from "@/shared/api/live-view";

// POST /api/live/runs/{runId}/renew — buy one more window before the cluster expires.
//
// Allowed once per cluster; the API enforces that, not this route. A second attempt answers 409.
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/runs/${runId}/renew`,
    { method: "POST" },
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
    /* the next poll carries it */
  }
  return jsonNoStore(toLiveRunView({ ...payload, telemetry } as never));
}
