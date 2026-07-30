import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/learning/progress — the signed-in learner's Academy progress.
//
// Session-gated because progress belongs to an account. A visitor who is not signed in still gets a
// working Academy: the client keeps their progress locally and says so, and that local progress can
// never earn a certificate. That distinction is enforced by the API, not by the page.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, { kind: "read" });
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const courseId = url.searchParams.get("courseId") ?? "";
  const version = url.searchParams.get("courseVersion") ?? "";
  const query = new URLSearchParams();
  if (courseId) query.set("courseId", courseId);
  if (version) query.set("courseVersion", version);

  const res = await liveFetch(
    `/v1/learning/progress${query.size ? `?${query}` : ""}`,
    undefined,
    g.caller.owner,
  );
  return jsonNoStore(
    await res.json().catch(() => ({})),
    res.ok ? 200 : res.status,
  );
}
