import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/drills — the drill catalog with its solve statistics.
//
// Owner-scoped: the same response carries the field's average alongside the caller's own best, so
// the picker can put them side by side without a second round trip.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const res = await liveFetch("/v1/drills", undefined, g.caller.owner);
  const payload = await res.json().catch(() => ({}));
  return jsonNoStore(payload, res.ok ? 200 : res.status);
}
