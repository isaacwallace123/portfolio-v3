import { NextResponse } from "next/server";
import { getRunEngine } from "@/shared/lib/runEngine";

// POST /api/v1/runs — admit an allowlisted scenario. Body: { scenarioId, requestedBy? }.
// An Idempotency-Key header makes retries safe: the same key returns the same run.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { scenarioId?: string; requestedBy?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const scenarioId = String(body.scenarioId ?? "");
  if (!scenarioId) {
    return NextResponse.json(
      { error: "scenarioId is required." },
      { status: 400 },
    );
  }

  const idempotencyKey =
    req.headers.get("Idempotency-Key")?.slice(0, 200) || undefined;

  const result = getRunEngine().createRun({
    scenarioId,
    idempotencyKey,
    requestedBy: body.requestedBy,
  });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error.message, code: result.error.code },
      { status: result.error.status },
    );
  }

  return NextResponse.json(result.run, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}
