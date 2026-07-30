import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

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
    `/v1/ranked/${runId}/inspect`,
    {
      method: "POST",
      body: JSON.stringify({ query: String(body.query ?? "") }),
    },
    g.caller.owner,
    g.caller.displayName,
  );
  const payload = await res.json().catch(() => ({}));
  return jsonNoStore(payload, res.status);
}
