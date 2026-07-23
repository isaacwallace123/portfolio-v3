import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// GET /api/live/runs/{runId} — the real run merged with its live telemetry.
// DELETE /api/live/runs/{runId} — tear the run down.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  const runRes = await liveFetch(`/v1/runs/${runId}`);
  if (runRes.status === 404)
    return NextResponse.json({ error: "No such run." }, { status: 404 });
  const run = await runRes.json().catch(() => ({}));
  if (!runRes.ok) return NextResponse.json(run, { status: runRes.status });

  // Best-effort telemetry — a run that is still provisioning has no metrics yet.
  let telemetry = null;
  try {
    const tRes = await liveFetch(`/v1/runs/${runId}/telemetry`);
    if (tRes.ok) telemetry = await tRes.json();
  } catch {
    /* leave telemetry null */
  }

  return NextResponse.json(toLiveRunView({ ...run, telemetry }), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  const res = await liveFetch(`/v1/runs/${runId}`, { method: "DELETE" });
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, { status: res.status });
}
