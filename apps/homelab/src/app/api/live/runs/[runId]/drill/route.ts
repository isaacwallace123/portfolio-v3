import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// POST   /api/live/runs/{runId}/drill — start a drill ON the running practice cluster. Body: { drillId }.
// DELETE /api/live/runs/{runId}/drill — end the drill; the cluster stays up as an open sandbox.
export const dynamic = "force-dynamic";

async function withTelemetry(runId: string, payload: Record<string, unknown>) {
  let telemetry = null;
  try {
    const res = await liveFetch(`/v1/runs/${runId}/telemetry`);
    if (res.ok) telemetry = await res.json();
  } catch {
    /* the next poll fills it in */
  }
  return toLiveRunView({ ...payload, telemetry } as never);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  let body: { drillId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const res = await liveFetch(`/v1/runs/${runId}/drill`, {
    method: "POST",
    body: JSON.stringify({ drillId: String(body.drillId ?? "") }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(payload, { status: res.status });
  return NextResponse.json(await withTelemetry(runId, payload));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  const res = await liveFetch(`/v1/runs/${runId}/drill`, { method: "DELETE" });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(payload, { status: res.status });
  return NextResponse.json(await withTelemetry(runId, payload));
}
