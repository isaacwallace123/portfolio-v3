import { guard, jsonNoStore, readBoundedStringBody } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";
import { toLiveRunView } from "@/shared/api/live-view";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const g = await guard(req, { runId });
  if (!g.ok) return g.response;

  const body = await readBoundedStringBody(req, "command", 128);
  if (!body.ok) return body.response;
  const res = await liveFetch(
    `/v1/ranked/${runId}/commands`,
    {
      method: "POST",
      body: JSON.stringify({ command: body.value }),
    },
    g.caller.owner,
    g.caller.displayName,
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
    /* The next snapshot supplies the measured consequence. */
  }

  return jsonNoStore(toLiveRunView({ ...payload, telemetry }));
}
