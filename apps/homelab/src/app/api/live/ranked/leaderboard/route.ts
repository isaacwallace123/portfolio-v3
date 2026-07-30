import { guardPublic, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

/** Public ELO standings. A verified session only marks which row belongs to the viewer. */
export async function GET(req: Request) {
  const g = await guardPublic(req);
  if (!g.ok) return g.response;

  const res = await liveFetch(
    "/v1/ranked/leaderboard?limit=25",
    undefined,
    g.caller?.owner,
    g.caller?.displayName,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
