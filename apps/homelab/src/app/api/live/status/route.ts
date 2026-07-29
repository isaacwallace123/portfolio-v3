import { guardInventory, jsonNoStore } from "@/shared/api/guard";
import { liveEnabled, liveFetch } from "@/shared/api/live-server";
import { getCaller } from "@/shared/api/session";

// GET /api/live/status — what this visitor may do right now: whether live control is configured,
// whether they are signed in, and (if so) the cluster they already own so a reload resumes it.
//
// Public, because a visitor has to be able to ask before they can sign in — but throttled, because
// answering costs an auth round trip plus a run listing for anyone who presents a cookie.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!liveEnabled())
    return jsonNoStore({
      enabled: false,
      signedIn: false,
      displayName: null,
      myRunId: null,
    });

  const denied = guardInventory(req);
  if (denied) return denied;

  const caller = await getCaller(req);

  let myRunId: string | null = null;
  if (caller) {
    try {
      const res = await liveFetch("/v1/runs", undefined, caller.owner);
      if (res.ok) {
        const runs = (await res.json()) as { runId: string; status: string }[];
        myRunId = runs.find((r) => r.status !== "deleting")?.runId ?? null;
      }
    } catch {
      /* treated as "no cluster yet" */
    }
  }

  return jsonNoStore({
    enabled: true,
    signedIn: caller !== null,
    displayName: caller?.displayName ?? null,
    myRunId,
  });
}
