import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";
import { toLiveRunView } from "@/shared/lib/liveView";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled()) {
    return NextResponse.json(
      { error: "Live practice controls are not configured." },
      { status: 503 },
    );
  }
  const { runId } = await context.params;
  const body = await req.json().catch(() => ({}));
  const res = await liveFetch(`/v1/practice/${runId}/actions`, {
    method: "POST",
    body: JSON.stringify({ actionId: String(body.actionId ?? "") }),
  });
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(res.ok ? toLiveRunView(payload) : payload, {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
