import type { RunView, ScenarioCatalog } from "@iw/lab-runtime";

// Browser client for the run-controller contract. Same-origin (the BFF routes under /api/v1), so no
// base URL or credentials plumbing is needed here.

export async function fetchCatalog(): Promise<ScenarioCatalog> {
  const res = await fetch("/api/v1/scenarios", { cache: "no-store" });
  if (!res.ok) throw new Error(`scenarios ${res.status}`);
  return res.json();
}

export async function createRun(
  scenarioId: string,
  idempotencyKey: string,
): Promise<RunView> {
  const res = await fetch("/api/v1/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ scenarioId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `runs ${res.status}`);
  return body as RunView;
}

export async function submitDecision(
  runId: string,
  decisionId: string,
): Promise<RunView> {
  const res = await fetch(`/api/v1/runs/${runId}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisionId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `decision ${res.status}`);
  return body as RunView;
}

// Subscribe to the run's SSE feed. Returns an unsubscribe function. `onSnapshot` fires with each
// projected RunView; `onDone` fires once when the stream closes on a terminal run.
export function subscribeToRun(
  runId: string,
  handlers: { onSnapshot: (run: RunView) => void; onDone?: () => void },
): () => void {
  const source = new EventSource(`/api/v1/runs/${runId}/events`);

  source.addEventListener("snapshot", (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data);
      if (parsed.run) handlers.onSnapshot(parsed.run as RunView);
    } catch {
      // ignore malformed frame
    }
  });

  source.addEventListener("report-ready", () => {
    handlers.onDone?.();
    source.close();
  });

  source.onerror = () => {
    // The stream closes itself on terminal runs; treat a closed connection as done.
    if (source.readyState === EventSource.CLOSED) {
      handlers.onDone?.();
    }
  };

  return () => source.close();
}
