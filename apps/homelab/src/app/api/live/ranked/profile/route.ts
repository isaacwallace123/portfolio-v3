import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

/** The signed-in operator's seasonless rating, progression, and recent attempt ledger. */
export async function GET(req: Request) {
  const g = await guard(req, { kind: "read" });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    "/v1/ranked/profile",
    undefined,
    g.caller.owner,
    g.caller.displayName,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
