import { guardPublic, jsonNoStore } from "@/shared/api/guard";
import {
  toLeaderboardView,
  type RawLeaderboard,
} from "@/shared/api/leaderboard-view";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/leaderboard — the single fastest-recovery ladder across ranked incidents.
//
// Public, unlike the rest of /api/live/*: a leaderboard nobody can read until they have an account
// is not a leaderboard. A session is optional and only decides whether a row comes back marked as
// yours — the API already treats an absent owner key as "no row is yours". Either way the board
// shows the display names operators solved under, and nothing else about them.
export const dynamic = "force-dynamic";

/** Deep enough that the board is a standing rather than a podium, shallow enough to stay one page. */
const BOARD_LIMIT = 25;

export async function GET(req: Request) {
  const g = await guardPublic(req);
  if (!g.ok) return g.response;

  const res = await liveFetch(
    `/v1/leaderboard?limit=${BOARD_LIMIT}`,
    undefined,
    g.caller?.owner,
  );
  const payload = await res.json().catch(() => ({}));

  // Upstream failures pass through as they are: the client reads `error` off the body and shows it.
  if (!res.ok) return jsonNoStore(payload, res.status);

  return jsonNoStore(toLeaderboardView(payload as RawLeaderboard), 200);
}
