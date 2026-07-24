import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!liveEnabled())
    return NextResponse.json({ error: "Live disabled." }, { status: 503 });

  const { runId } = await params;
  const res = await liveFetch(`/v1/runs/${runId}/report`);
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
