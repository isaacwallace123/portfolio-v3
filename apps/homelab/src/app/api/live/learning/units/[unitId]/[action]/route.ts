import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// POST /api/live/learning/units/{unitId}/{start|complete} — record curriculum progress.
//
// One route for both verbs because they are the same forward with the same guard, and because the
// alternative was two files differing by a word. The action is allowlisted rather than interpolated
// blindly: everything after `units/` ends up in an upstream URL.
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["start", "complete"]);

/** Content-derived, and the same shape the API validates. Checked here so a crafted segment never
 *  reaches the upstream path — the manifest check upstream is the real boundary. */
const UNIT_ID =
  /^(lesson|checkpoint|drill|assessment):[a-z0-9-]+(:[a-z0-9-]+)?$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ unitId: string; action: string }> },
) {
  const { unitId, action } = await params;
  if (!ACTIONS.has(action) || !UNIT_ID.test(unitId))
    return jsonNoStore({ error: "No such unit." }, 404);

  const g = await guard(req);
  if (!g.ok) return g.response;

  // The body is forwarded rather than rebuilt: it carries the score, elapsed time and clean flag a
  // unit finished with. None of it grants anything — the API decides what those add up to.
  const body = await req.json().catch(() => ({}));

  const res = await liveFetch(
    `/v1/learning/units/${encodeURIComponent(unitId)}/${action}`,
    { method: "POST", body: JSON.stringify(body) },
    g.caller.owner,
    g.caller.displayName,
  );
  return jsonNoStore(
    await res.json().catch(() => ({})),
    res.ok ? 200 : res.status,
  );
}
