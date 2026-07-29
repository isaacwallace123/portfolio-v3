import type { DrillOption, LiveRunView } from "@/shared/api/live-view";

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

/** Carries the HTTP status, so a caller can tell "this cluster is gone" from "that request
    failed". The difference decides whether polling gives up or simply tries again. */
export class LiveError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LiveError";
    this.status = status;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new LiveError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
    );
  }
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
  /** What the pod is doing while it is not ready ("ContainerCreating", "Scheduling"), else "". */
  detail: string;
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

/** One drill in the catalog, with what the field has actually done on it. */
export interface DrillCatalogEntry {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  difficulty: string;
  objective: string;
  /** practice (one incident) | ranked (a cascade, timed for the board). */
  mode: "practice" | "ranked";
  parSeconds: number;
  stageCount: number;
  stages: { id: string; title: string }[];
  /** Over every recorded attempt by everyone — which is what makes an average mean something. */
  attempts: number;
  operators: number;
  averageMs: number;
  bestMs: number;
  yourAttempts: number;
  yourBestMs: number | null;
  yourAverageMs: number | null;
}

export interface DrillCatalog {
  /** Requests a second one k6 generator offers. The load dial is demand, not capacity. */
  offeredPerGenerator: number;
  drills: DrillCatalogEntry[];
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  isYou: boolean;
  drillsSolved: number;
  bestMs: number;
  averageMs: number;
  missteps: number;
  achievedUtc: string;
}

export interface LeaderboardView {
  overall: LeaderboardEntry[];
  byDrill: { drillId: string; title: string; entries: LeaderboardEntry[] }[];
}

export async function fetchDrills(): Promise<DrillCatalog> {
  const res = await fetch("/api/live/drills", { cache: "no-store" });
  return asJson(res);
}

export async function fetchLeaderboard(): Promise<LeaderboardView> {
  const res = await fetch("/api/live/leaderboard", { cache: "no-store" });
  return asJson(res);
}

// A drill runs ON the provisioned cluster: it sets an objective and clock and unlocks decisions
// against the same live workload, rather than provisioning a second environment.
//
// Ranked mode sends no drill id: the broker draws one from the multi-stage pool, so the time it
// records is about the operator rather than about which drill they chose to be timed on.
export async function startDrill(
  runId: string,
  drillId: string,
  mode: "practice" | "ranked" = "practice",
): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}/drill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drillId, mode }),
  });
  return asJson(res);
}

export async function endDrill(runId: string): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}/drill`, {
    method: "DELETE",
  });
  return asJson(res);
}

/** Buy one more window before the cluster expires. Allowed once; a second attempt is a 409. */
export async function renewRun(runId: string): Promise<LiveRunView> {
  const res = await fetch(`/api/live/runs/${runId}/renew`, { method: "POST" });
  return asJson(res);
}

/** One condition of a drill's objective, with the cluster's current value against it. */
export interface DrillGoal {
  label: string;
  target: string;
  current: string;
  met: boolean;
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

/** One frame of a cluster: the run and everything measured about it, at one instant. */
export interface ClusterSnapshot {
  run: LiveRunView;
  components: RunComponent[];
  events: ClusterEvent[];
  trace: LiveTrace | null;
}

export async function fetchSnapshot(runId: string): Promise<ClusterSnapshot> {
  const res = await fetch(`/api/live/runs/${runId}/snapshot`);
  return asJson(res);
}

// Real Kubernetes Events from the run namespace.
export async function teardownLiveRun(runId: string): Promise<void> {
  const res = await fetch(`/api/live/runs/${runId}`, { method: "DELETE" });
  await asJson(res);
}

// Returns null while no trace has been captured yet (traffic off, or the workload still starting).
export async function getLiveReport(runId: string): Promise<LiveReport | null> {
  const res = await fetch(`/api/live/runs/${runId}/report`, {
    cache: "no-store",
  });
  if (res.status === 409 || res.status === 404) return null;
  return asJson(res);
}

export type { DrillOption, LiveRunView };
