import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";

// GET /api/live/runs/{runId}/events — real, sanitized Kubernetes Events from the run namespace.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  const res = await liveFetch(`/v1/runs/${runId}/events`);
  if (!res.ok) {
    // An event feed that is not ready yet must not break the page.
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }
  const payload = await res.json().catch(() => []);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
