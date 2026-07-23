import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

// POST /api/live/runs/{runId}/decisions — apply an operator decision. Body: { decisionId }.
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  let body: { decisionId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const res = await liveFetch(`/v1/runs/${runId}/decisions`, {
    method: "POST",
    body: JSON.stringify({ decisionId: String(body.decisionId ?? "") }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(payload, { status: res.status });
  return NextResponse.json(toLiveRunView(payload), { status: res.status });
}
