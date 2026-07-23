import { NextResponse } from "next/server";
import { getRunEngine } from "@/shared/lib/runEngine";

// GET /api/v1/runs/{runId}/report — the published after-action report (404 until the run completes).
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const report = getRunEngine().getReport(runId);
  if (!report) {
    return NextResponse.json(
      { error: "Report is not ready." },
      { status: 404 },
    );
  }
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
