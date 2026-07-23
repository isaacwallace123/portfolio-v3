import { NextResponse } from "next/server";
import { getRunEngine } from "@/shared/lib/runEngine";

// GET /api/v1/runs/{runId} — the sanitized run read model.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = getRunEngine().getRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Unknown run." }, { status: 404 });
  }
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
}
