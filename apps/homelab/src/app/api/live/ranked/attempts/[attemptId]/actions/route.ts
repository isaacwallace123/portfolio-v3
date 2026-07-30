import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

const ATTEMPT_ID = /^[a-f0-9]{32}$/;

export async function GET(
  req: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await context.params;
  const g = await guard(req, { kind: "read" });
  if (!g.ok) return g.response;
  if (!ATTEMPT_ID.test(attemptId))
    return jsonNoStore({ error: "Malformed ranked attempt id." }, 400);

  const res = await liveFetch(
    `/v1/ranked/attempts/${attemptId}/actions`,
    undefined,
    g.caller.owner,
    g.caller.displayName,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
