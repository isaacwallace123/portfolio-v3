// Browser client for the live-cluster panel. Same-origin calls to this app's /api/live/* routes,
// which proxy (server-side, with a scoped key) to the real HomeOps API.

export interface LiveTelemetry {
  podCount: number;
  cpuMillicores: number;
  memoryMiB: number;
  apiReplicas: number;
  cacheEnabled: boolean;
}

export interface LiveRun {
  runId: string;
  scenarioId: string;
  status: string;
  namespace: string | null;
  apiReplicas: number;
  cacheEnabled: boolean;
  ttlSeconds: number;
  createdAt?: string;
  telemetry: LiveTelemetry | null;
}

async function asJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function fetchLiveStatus(): Promise<{
  enabled: boolean;
  scenarioId: string;
}> {
  const res = await fetch("/api/live/status", { cache: "no-store" });
  return asJson(res);
}

export async function createLiveRun(scenarioId: string): Promise<LiveRun> {
  const res = await fetch("/api/live/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
  return { telemetry: null, ...(await asJson(res)) };
}

export async function getLiveRun(runId: string): Promise<LiveRun> {
  const res = await fetch(`/api/live/runs/${runId}`, { cache: "no-store" });
  return asJson(res);
}

export async function liveDecision(
  runId: string,
  decisionId: string,
): Promise<LiveRun> {
  const res = await fetch(`/api/live/runs/${runId}/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisionId }),
  });
  return { telemetry: null, ...(await asJson(res)) };
}

export async function teardownLiveRun(runId: string): Promise<void> {
  const res = await fetch(`/api/live/runs/${runId}`, { method: "DELETE" });
  await asJson(res);
}
