import { guard, jsonNoStore, readBoundedStringBody } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

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
    `/v1/ranked/${runId}/inspect`,
    {
      method: "POST",
      body: JSON.stringify({ query: body.value }),
    },
    g.caller.owner,
    g.caller.displayName,
  );
  const payload = await res.json().catch(() => ({}));
  return jsonNoStore(payload, res.status);
}
