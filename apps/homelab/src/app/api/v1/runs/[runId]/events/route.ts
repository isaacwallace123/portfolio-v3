import { getRunEngine } from "@/shared/lib/runEngine";
import { isTerminalPhase, type RunEventEnvelope } from "@iw/lab-runtime";

// GET /api/v1/runs/{runId}/events — Server-Sent Events. Each tick emits a full `snapshot` projection
// plus discrete `lifecycle` / `decision` / `report-ready` deltas. Only the sanitized RunView crosses
// the wire; the transport is deliberately dumb so the Crossplane engine can back it unchanged.
export const dynamic = "force-dynamic";

const TICK_MS = 1_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const engine = getRunEngine();

  if (!engine.getRun(runId)) {
    return new Response(JSON.stringify({ error: "Unknown run." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let seq = 0;
  let lastStatus = "";
  let lastDecisionCount = 0;
  let reportAnnounced = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (envelope: RunEventEnvelope) => {
        controller.enqueue(
          encoder.encode(
            `event: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`,
          ),
        );
      };

      const tick = () => {
        const run = engine.getRun(runId);
        if (!run) {
          controller.close();
          return;
        }
        const now = new Date().toISOString();

        if (run.status !== lastStatus) {
          lastStatus = run.status;
          send({
            type: "lifecycle",
            seq: seq++,
            at: now,
            runId,
            status: run.status,
          });
        }

        for (let i = lastDecisionCount; i < run.acceptedDecisions.length; i++) {
          send({
            type: "decision",
            seq: seq++,
            at: now,
            runId,
            decision: run.acceptedDecisions[i],
          });
        }
        lastDecisionCount = run.acceptedDecisions.length;

        send({ type: "snapshot", seq: seq++, at: now, run });

        if (run.reportReady && !reportAnnounced) {
          reportAnnounced = true;
          send({ type: "report-ready", seq: seq++, at: now, runId });
        }

        if (isTerminalPhase(run.status)) {
          clearInterval(timer);
          controller.close();
        }
      };

      const timer = setInterval(tick, TICK_MS);
      tick(); // immediate first frame

      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
