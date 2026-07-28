import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/api/live-server";
import { getCaller } from "@/shared/api/session";

// GET /api/live/status — what this visitor may do right now: whether live control is configured,
// whether they are signed in, and (if so) the cluster they already own so a reload resumes it.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const enabled = liveEnabled();
  const caller = enabled ? await getCaller(req) : null;

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

  return NextResponse.json(
    {
      enabled,
      signedIn: caller !== null,
      displayName: caller?.displayName ?? null,
      myRunId,
    },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
