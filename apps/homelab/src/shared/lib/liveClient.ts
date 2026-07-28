import type { DrillOption, LiveRunView } from "@/shared/lib/liveView";

export interface LivePlatformStatus {
  cluster: "ready" | "degraded" | "offline";
  nodesReady: number;
  nodesTotal: number;
  activeRuns: number;
  maxConcurrentRuns: number;
  slotsAvailable: number;
  capacityFreePct: number;
}

export interface PlatformOverview {
  cluster: "ready" | "degraded" | "offline";
  nodesReady: number;
  nodesTotal: number;
  workloadsReady: number;
  workloadsDesired: number;
  runningPods: number;
  cpuUtilizationPct: number;
  memoryUtilizationPct: number;
  gitOpsHealthy: number;
  gitOpsTotal: number;
  activeRuns: number;
  maxConcurrentRuns: number;
  slotsAvailable: number;
  observedAt: string;
}

export interface TopologyNode {
  id: string;
  label: string;
  layer: "compute" | "network" | "platform" | "data" | "observe" | "apps";
  kind: string;
  status: "healthy" | "degraded" | "unavailable";
  ready: number;
  desired: number;
  cpuMillicores: number;
  memoryMiB: number;
  cpuUtilizationPct: number | null;
  memoryUtilizationPct: number | null;
  description: string;
  observedAt: string;
  gitOpsSync: string | null;
  gitOpsHealth: string | null;
}

export interface HomelabTopology {
  observedAt: string;
  source: string;
  nodes: TopologyNode[];
  edges: { source: string; target: string; kind: string }[];
}

export interface LiveSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  durationMs: number;
  status: "ok" | "error";
  attributes: Record<string, string>;
}

export interface LiveTrace {
  traceId: string;
  release: string;
  durationMs: number;
  capturedAt: string;
  spans: LiveSpan[];
}

export interface LiveReport {
  runId: string;
  scenarioId: string;
  outcome: "passed" | "degraded" | "failed";
  score: number;
  objective: string;
  summary: string;
  decisions: { id: string; label: string; acceptedAtMs: number }[];
  findings: { label: string; detail: string; severity: string }[];
  sealedAt: string;
}

// Browser client for the live arena. Same-origin calls to /api/live/*, which proxy (server-side,
// with a scoped key) to the real HomeOps API and merge the run with the scenario's incident model.
// Everything returns the RunView shape the arena already renders.

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface LiveStatus {
  enabled: boolean;
  /** Whether this visitor has a valid SSO session (verified server-side). */
  signedIn: boolean;
  displayName: string | null;
  /** The cluster this visitor already owns, so a reload resumes it. */
  myRunId: string | null;
}

/** One pod of a cluster component, with measured usage. */
export interface RunPod {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  cpuMillicores: number;
  memoryMiB: number;
}

/** One tier of the request path, with per-pod detail. */
export interface RunComponent {
  name: string;
  desired: number;
  ready: number;
  cpuMillicores: number;
  memoryMiB: number;
  cpuLimitMillicoresPerPod: number;
  pods: RunPod[];
}

export async function fetchComponents(runId: string): Promise<RunComponent[]> {
  const res = await fetch(`/api/live/runs/${runId}/components`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchLiveStatus(): Promise<LiveStatus> {
  const res = await fetch("/api/live/status", { cache: "no-store" });
  return asJson(res);
}

export async function fetchPlatformStatus(): Promise<LivePlatformStatus> {
  const res = await fetch("/api/live/platform", { cache: "no-store" });
  return asJson(res);
}

export async function fetchOverview(): Promise<PlatformOverview> {
  const res = await fetch("/api/live/overview", { cache: "no-store" });
  return asJson(res);
}

export async function fetchTopology(): Promise<HomelabTopology> {
  const res = await fetch("/api/live/topology", { cache: "no-store" });
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

export async function practiceAction(
  runId: string,
  actionId: string,
): Promise<LiveRunView> {
  const res = await fetch(`/api/live/practice/${runId}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId }),
  });
  return asJson(res);
}

// A drill runs ON the provisioned cluster: it sets an objective and clock and unlocks decisions
// against the same live workload, rather than provisioning a second environment.
export async function startDrill(
  runId: string,
  drillId: string,
): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}/drill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drillId }),
  });
  return asJson(res);
}

export async function endDrill(runId: string): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}/drill`, {
    method: "DELETE",
  });
  return asJson(res);
}

export interface ClusterEvent {
  id: string;
  at: string;
  source: string;
  reason: string;
  message: string;
  severity: "info" | "warning";
  objectKind: string;
}

// Real Kubernetes Events from the run namespace.
export async function fetchRunEvents(runId: string): Promise<ClusterEvent[]> {
  const res = await fetch(`/api/live/runs/${runId}/events`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function teardownLiveRun(runId: string): Promise<void> {
  const res = await fetch(`/api/live/runs/${runId}`, { method: "DELETE" });
  await asJson(res);
}

export async function getLiveTrace(runId: string): Promise<LiveTrace | null> {
  const res = await fetch(`/api/live/runs/${runId}/trace`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  return asJson(res);
}

export async function getLiveReport(runId: string): Promise<LiveReport | null> {
  const res = await fetch(`/api/live/runs/${runId}/report`, {
    cache: "no-store",
  });
  if (res.status === 409 || res.status === 404) return null;
  return asJson(res);
}

export type { DrillOption, LiveRunView };
