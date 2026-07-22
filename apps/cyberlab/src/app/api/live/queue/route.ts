import { NextResponse } from "next/server";
import { enqueue, getLiveState } from "@/entities/scenario/liveSim";

// Queue a scenario to run next. In the demo the queue is process-memory only and the simulated
// engine doesn't drain it (it rotates on the clock); the real orchestrator consumes this queue and
// clones the disposable VMs. Kept read-mostly + rate-shaped so a public endpoint can't be abused.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { caseStudyId?: string; requestedBy?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const caseStudyId = String(body.caseStudyId ?? "");
  if (!caseStudyId) {
    return NextResponse.json(
      { error: "caseStudyId is required." },
      { status: 400 },
    );
  }

  const requestedBy = String(body.requestedBy ?? "guest").slice(0, 40);
  const item = enqueue(caseStudyId, requestedBy);
  if (!item) {
    return NextResponse.json({ error: "Unknown case study." }, { status: 404 });
  }

  return NextResponse.json({ queued: item, state: getLiveState() });
}
