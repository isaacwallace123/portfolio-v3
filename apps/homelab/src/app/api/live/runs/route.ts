import { guard, jsonNoStore } from "@/shared/lib/guard";
import { liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// POST /api/live/runs — provision a practice cluster for the signed-in caller.
// Requires a valid session; the API caps one live cluster per owner.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await guard(req, { kind: "provision" });
  if (!g.ok) return g.response;

  let body: { scenarioId?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults below */
  }

  const res = await liveFetch(
    "/v1/runs",
    {
      method: "POST",
      body: JSON.stringify({
        scenarioId: String(body.scenarioId ?? "practice-cluster"),
      }),
    },
    g.caller.owner,
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return jsonNoStore(payload, res.status);
  return jsonNoStore(toLiveRunView(payload), res.status);
}
