import type { LiveRunView } from "@/shared/lib/liveView";

// Browser client for the live arena. Same-origin calls to /api/live/*, which proxy (server-side,
// with a scoped key) to the real HomeOps API and merge the run with the scenario's incident model.
// Everything returns the RunView shape the arena already renders.

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function fetchLiveStatus(): Promise<{
  enabled: boolean;
  scenarioId: string;
}> {
  const res = await fetch("/api/live/status", { cache: "no-store" });
  return asJson(res);
}

export async function createLiveRun(scenarioId: string): Promise<LiveRunView> {
  const res = await fetch("/api/live/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
  return asJson(res);
}

export async function getLiveRun(runId: string): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}`, { cache: "no-store" });
  return asJson(res);
}

export async function liveDecision(
  runId: string,
  decisionId: string,
): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisionId }),
  });
  return asJson(res);
}

export async function teardownLiveRun(runId: string): Promise<void> {
  const res = await fetch(`/api/live/runs/${runId}`, { method: "DELETE" });
  await asJson(res);
}

export type { LiveRunView };
