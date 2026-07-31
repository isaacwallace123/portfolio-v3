import { guard, jsonNoStore, readBoundedStringBody } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";
import { toLiveRunView, type RealRun } from "@/shared/api/live-view";

export const dynamic = "force-dynamic";

interface Frame {
  run?: RealRun;
  telemetry?: RealRun["telemetry"];
}

/**
 * One unrated operator command against the learner's own cluster.
 *
 * The upstream twin of the ranked route, minus the audit: nothing here spends an action budget or
 * touches a rated attempt. Like its twin it answers with a judged snapshot rather than the bare
 * RunView the command returns, because a RunView carries no measured goals — sending it back would
 * blank the objective panel on every accepted change.
 */
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
    `/v1/practice/${runId}/commands`,
    { method: "POST", body: JSON.stringify({ command: body.value }) },
    g.caller.owner,
    g.caller.displayName,
  );
  const payload = (await res.json().catch(() => ({}))) as RealRun;
  if (!res.ok) return jsonNoStore(payload, res.status);

  let frame: Frame = {};
  try {
    const snap = await liveFetch(
      `/v1/runs/${runId}/snapshot`,
      undefined,
      g.caller.owner,
      g.caller.displayName,
    );
    if (snap.ok) frame = (await snap.json()) as Frame;
  } catch {
    /* Fall back to the command's own view; the next poll supplies the measured consequence. */
  }

  return jsonNoStore(
    toLiveRunView({
      ...(frame.run ?? payload),
      telemetry: frame.telemetry ?? null,
    }),
  );
}
