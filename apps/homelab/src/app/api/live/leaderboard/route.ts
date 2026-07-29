import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/leaderboard — ranked standings across the multi-stage drills.
//
// Signed in like every other live route, so the board can mark which row is yours. It shows the
// display names operators solved under, and nothing else about them.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const res = await liveFetch("/v1/leaderboard?limit=25", undefined, g.caller.owner);
  const payload = await res.json().catch(() => ({}));
  return jsonNoStore(payload, res.ok ? 200 : res.status);
}
