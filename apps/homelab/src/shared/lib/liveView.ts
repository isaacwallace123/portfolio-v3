import type { RunTelemetry, RunView } from "@iw/lab-runtime";

/** One option in the active drill's quiz. Correctness is withheld until it is chosen. */
export interface DrillOption {
  id: string;
  label: string;
  description: string;
  unlocked: boolean;
  /** Seconds until this option unlocks, so the UI can explain the wait. */
  unlocksInSeconds: number;
  chosen: boolean;
  isCorrect: boolean | null;
  explanation: string;
}

// Projects the API's run model into the shape the arena renders. Everything here is real: the run is
// a Crossplane LabRun (disposable namespace + live workload), the telemetry is measured by that run's
// Envoy gateway and metrics-server, and the drill clock, decisions, and their unlock state are
// broker-authoritative. Nothing is simulated — the event stream comes from real Kubernetes Events on
// a separate endpoint, and operator decisions patch the live workload.

// SLO the arena scores against (ms). Matches the drill objectives in the API catalog.
const LATENCY_TARGET_MS = 120;
export interface RealRun {
  runId: string;
  scenarioId: string;
  status: string; // provisioning | ready | deleting
  namespace: string | null;
  apiReplicas: number;
  cacheEnabled: boolean;
  releaseTrack?: "stable" | "candidate";
  dataState?: "healthy" | "degraded" | "recovered";
  targetPool?: "apps" | "infra";
  loadEnabled?: boolean;
  loadGenerators?: number;
  restartToken?: string;
  acceptedDecisions?: {
    id: string;
    label: string;
    acceptedAtMs: number;
  }[];
  availableDecisions?: string[];
  // The drill currently layered on this cluster ("" when it is an open sandbox).
  drillId?: string;
  drillTitle?: string;
  drillObjective?: string;
  drillElapsedSeconds?: number;
  drillDurationSeconds?: number;
  drillComplete?: boolean;
  drillSolved?: boolean;
  drillCorrectChosen?: number;
  drillCorrectTotal?: number;
  drillWrongChosen?: number;
  drillOptions?: DrillOption[];
  ttlSeconds: number;
  createdAt?: string;
  telemetry?: {
    podCount: number;
    cpuMillicores: number;
    memoryMiB: number;
    postgresCpuPct: number;
    requestsPerSec: number;
    p95LatencyMs: number;
    errorRatePct: number;
  } | null;
}

// RunView plus the real cluster facts the arena surfaces (namespace, measured usage).
export interface LiveRunView extends RunView {
  live: true;
  namespace: string | null;
  podCount: number | null;
  cpuMillicores: number | null;
  memoryMiB: number | null;
  releaseTrack: "stable" | "candidate";
  dataState: "healthy" | "degraded" | "recovered";
  targetPool: "apps" | "infra";
  loadEnabled: boolean;
  /** How many k6 generators are running — the load-intensity dial. */
  loadGenerators: number;
  restartToken: string;
  // Active drill layered on this cluster ("" when it is an open sandbox).
  drillId: string;
  drillTitle: string;
  drillObjective: string;
  drillComplete: boolean;
  drillSolved: boolean;
  drillCorrectChosen: number;
  drillCorrectTotal: number;
  drillWrongChosen: number;
  drillOptions: DrillOption[];
}

export function toLiveRunView(real: RealRun): LiveRunView {
  const createdMs = real.createdAt ? Date.parse(real.createdAt) : Date.now();

  // The active drill's clock is owned by the API (it starts when the drill starts, not when the
  // cluster was provisioned). Everything below is measured or broker-authoritative.
  const drillId = real.drillId ?? "";
  const drillDurationMs = (real.drillDurationSeconds ?? 0) * 1000;
  const drillElapsedMs = Math.min(
    (real.drillElapsedSeconds ?? 0) * 1000,
    drillDurationMs || Number.MAX_SAFE_INTEGER,
  );

  const accepted = new Set((real.acceptedDecisions ?? []).map((d) => d.id));

  // Treat the cluster as "running" once its pods are measured, not only when the LabRun's Ready
  // condition flips (that lags Crossplane reconciliation by up to a minute).
  const podsUp = (real.telemetry?.podCount ?? 0) > 0;
  const status: RunView["status"] =
    real.status === "deleting"
      ? "collecting"
      : real.drillComplete
        ? "complete"
        : real.status === "ready" || podsUp
          ? "running"
          : "provisioning";

  // 100% real telemetry — request rate, p95, and error rate are measured by the run's Envoy gateway;
  // replicas and cache reflect actual cluster state. Score and Postgres load are derived from those
  // real signals (there is no telemetry model any more).
  const t = real.telemetry;
  const target = LATENCY_TARGET_MS;
  const p95 = t?.p95LatencyMs ?? 0;
  const errRate = t?.errorRatePct ?? 0;
  const telemetry: RunTelemetry = {
    requestsPerSec: t?.requestsPerSec ?? 0,
    p95LatencyMs: p95,
    latencyTargetMs: target,
    errorRatePct: errRate,
    apiReplicas: real.apiReplicas,
    postgresCpuPct: t?.postgresCpuPct ?? 0,
    cacheActive: real.cacheEnabled,
    score: Math.max(0, 100 - (p95 > target ? 30 : 0) - (errRate > 1 ? 25 : 0)),
  };

  // Decisions and their unlock state are broker-authoritative (gated on the drill's own clock).
  const acceptedDecisions =
    real.acceptedDecisions ??
    [...accepted].map((id) => ({
      id,
      label: id,
      acceptedAtMs: 0,
    }));
  const availableDecisions = real.availableDecisions ?? [];

  const ttlMs = real.ttlSeconds * 1000;
  return {
    runId: real.runId,
    scenarioId: real.scenarioId,
    status,
    queuePosition: 0,
    createdAt: real.createdAt ?? new Date().toISOString(),
    elapsedMs: drillElapsedMs,
    durationMs: drillDurationMs,
    ttlMs,
    remainingTtlMs: Math.max(0, ttlMs - (Date.now() - createdMs)),
    telemetry,
    // The arena renders REAL Kubernetes Events from /api/live/runs/{id}/events instead of a
    // scripted timeline, so no synthetic events are projected here.
    visibleEvents: [],
    acceptedDecisions,
    availableDecisions,
    complete: status === "complete",
    reportReady: status === "complete",
    live: true,
    namespace: real.namespace,
    podCount: real.telemetry?.podCount ?? null,
    cpuMillicores: real.telemetry?.cpuMillicores ?? null,
    memoryMiB: real.telemetry?.memoryMiB ?? null,
    releaseTrack: real.releaseTrack ?? "stable",
    dataState: real.dataState ?? "healthy",
    targetPool: real.targetPool ?? "apps",
    loadEnabled: real.loadEnabled ?? true,
    loadGenerators: real.loadGenerators ?? (real.loadEnabled === false ? 0 : 1),
    restartToken: real.restartToken ?? "baseline",
    drillId,
    drillTitle: real.drillTitle ?? "",
    drillObjective: real.drillObjective ?? "",
    drillComplete: real.drillComplete ?? false,
    drillSolved: real.drillSolved ?? false,
    drillCorrectChosen: real.drillCorrectChosen ?? 0,
    drillCorrectTotal: real.drillCorrectTotal ?? 0,
    drillWrongChosen: real.drillWrongChosen ?? 0,
    drillOptions: real.drillOptions ?? [],
  };
}
