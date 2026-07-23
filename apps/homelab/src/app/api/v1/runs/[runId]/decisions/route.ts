import { NextResponse } from "next/server";
import { getRunEngine } from "@/shared/lib/runEngine";

// POST /api/v1/runs/{runId}/decisions — accept an allowlisted operator decision. Body: { decisionId }.
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  let body: { decisionId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const decisionId = String(body.decisionId ?? "");
  if (!decisionId) {
    return NextResponse.json(
      { error: "decisionId is required." },
      { status: 400 },
    );
  }

  const result = getRunEngine().submitDecision(runId, decisionId);
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error.message, code: result.error.code },
      { status: result.error.status },
    );
  }

  return NextResponse.json(result.run, {
    headers: { "Cache-Control": "no-store" },
  });
}
