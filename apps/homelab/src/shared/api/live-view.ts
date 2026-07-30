import type { RunTelemetry, RunView } from "@iw/lab-runtime";
import type {
  DrillGoal,
  RankedMatchBriefing,
  RankedMatchDebrief,
} from "@/shared/api/live-client";

/** One option in the active stage's quiz. Correctness is withheld until it is chosen. */
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
// Envoy gateways and metrics-server, and the drill clock, stage, decisions, and their unlock state
// are broker-authoritative. Nothing is simulated — the event stream comes from real Kubernetes Events
// on a separate endpoint, and operator decisions patch the live workload.

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
  targetPool?: "apps" | "infra" | "unavailable";
  loadEnabled?: boolean;
  loadGenerators?: number;
  canaryReplicas?: number;
  gatewayReplicas?: number;
  /** What the generators are asking for, at a fixed rate each — demand, not capacity. */
  offeredRequestsPerSec?: number;
  restartToken?: string;
  acceptedDecisions?: {
    id: string;
    label: string;
    acceptedAtMs: number;
    stage: number;
  }[];
  rankedActions?: {
    id: string;
    command: string;
    actionId: string;
    acceptedAtMs: number;
    stage: number;
    acceptedUtc: string;
  }[];
  availableDecisions?: string[];
  // The drill currently running on this cluster ("" when it is an open sandbox).
  drillId?: string;
  drillTitle?: string;
  drillObjective?: string;
  drillMode?: string;
  drillStage?: number;
  drillStageCount?: number;
  drillStageTitle?: string;
  drillStageObjective?: string;
  drillStageHandoff?: string;
  /** Whole-drill elapsed, frozen at the solve. */
  drillElapsedMs?: number;
  drillStageElapsedSeconds?: number;
  drillParSeconds?: number;
  drillComplete?: boolean;
  drillSolved?: boolean;
  drillFailed?: boolean;
  drillFailedMove?: string;
  drillCorrectChosen?: number;
  drillCorrectTotal?: number;
  drillCorrectChosenAll?: number;
  drillCorrectTotalAll?: number;
  drillWrongChosen?: number;
  drillOptions?: DrillOption[];
  drillGoals?: DrillGoal[];
  drillHeldSeconds?: number;
  drillHoldSeconds?: number;
  rankedBriefing?: RankedMatchBriefing | null;
  rankedDebrief?: RankedMatchDebrief | null;
  ttlSeconds: number;
  renewable: boolean;
  createdAt?: string;
  telemetry?: {
    podCount: number;
    cpuMillicores: number;
    memoryMiB: number;
    postgresCpuPct: number;
    requestsPerSec: number | null;
    p95LatencyMs: number | null;
    errorRatePct: number | null;
  } | null;
}

// RunView plus the real cluster facts the arena surfaces (namespace, measured usage).
export interface LiveRunView extends RunView {
  live: true;
  /** False once the single permitted extension has been used. */
  renewable: boolean;
  /** The LabRun is being collected. The API still answers for it, but it is gone. */
  deleting: boolean;
  namespace: string | null;
  podCount: number | null;
  cpuMillicores: number | null;
  memoryMiB: number | null;
  releaseTrack: "stable" | "candidate";
  dataState: "healthy" | "degraded" | "recovered";
  targetPool: "apps" | "infra" | "unavailable";
  loadEnabled: boolean;
  /** How many k6 generators are running — the load-intensity dial. */
  loadGenerators: number;
  /** Envoy replicas. Past ~2000 rps the gateway, not the app tier, is where requests queue. */
  gatewayReplicas: number;
  /** Replicas serving the candidate build beside the stable fleet. Zero is no canary. */
  canaryReplicas: number;
  /** Requests a second the generators are offering, served or not. */
  offeredRequestsPerSec: number;
  restartToken: string;
  /** Server-recorded mutations for the current competitive match. */
  rankedActions: {
    id: string;
    command: string;
    actionId: string;
    acceptedAtMs: number;
    stage: number;
    acceptedUtc: string;
  }[];
  // Active drill running on this cluster ("" when the cluster is an open sandbox).
  drillId: string;
  drillTitle: string;
  drillObjective: string;
  /** practice | ranked. Ranked drills are cascades and are the ones the board is built from. */
  drillMode: string;
  /** Position in the cascade, 1-based. Single-stage drills are stage 1 of 1. */
  drillStage: number;
  drillStageCount: number;
  drillStageTitle: string;
  drillStageObjective: string;
  /** What the last fix caused. Empty on the first stage of a drill. */
  drillStageHandoff: string;
  /** Seconds since the current stage began — what option unlocks are gated on. */
  drillStageElapsedSeconds: number;
  /** A reference time for the drill, not a deadline. */
  drillParSeconds: number;
  drillComplete: boolean;
  drillSolved: boolean;
  /** A ranked attempt ended by a wrong move: the damage stays, nothing further is judged. */
  drillFailed: boolean;
  /** The option id that ended it, so the panel can show which one and why. */
  drillFailedMove: string;
  drillCorrectChosen: number;
  drillCorrectTotal: number;
  /** The same counts across every stage so far — what the end-of-drill summary is about. */
  drillCorrectChosenAll: number;
  drillCorrectTotalAll: number;
  drillWrongChosen: number;
  drillOptions: DrillOption[];
  /** Live progress against the current stage's objective — what actually ends it. */
  drillGoals: DrillGoal[];
  /** How long every condition has held, and how long it must, before the stage resolves. */
  drillHeldSeconds: number;
  drillHoldSeconds: number;
  /** Safe pre-match projection: seed receipt, objectives, constraints, and visible instruments. */
  rankedBriefing: RankedMatchBriefing | null;
  /** Full generated plan, present only after the match is decided. */
  rankedDebrief: RankedMatchDebrief | null;
}

export function toLiveRunView(real: RealRun): LiveRunView {
  const createdMs = real.createdAt ? Date.parse(real.createdAt) : Date.now();

  // The drill clock is owned by the API: it starts when the drill starts (not when the cluster was
  // provisioned) and STOPS at the solve. It is deliberately not clamped to anything — a drill has no
  // deadline, so a long run is a slow result rather than a capped one. Clamping it to the scenario's
  // par time is what used to freeze every finished drill at 01:04.
  const drillId = real.drillId ?? "";
  const drillElapsedMs = Math.max(0, real.drillElapsedMs ?? 0);

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

  // 100% real telemetry — request rate, p95, and error rate are measured by the run's Envoy
  // gateways; replicas and cache reflect actual cluster state. Score and Postgres load are derived
  // from those real signals (there is no telemetry model any more).
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

  const acceptedDecisions = (real.acceptedDecisions ?? []).map((d) => ({
    id: d.id,
    label: d.label,
    acceptedAtMs: d.acceptedAtMs,
  }));
  const availableDecisions = real.availableDecisions ?? [];

  const ttlMs = real.ttlSeconds * 1000;
  const loadGenerators =
    real.loadGenerators ?? (real.loadEnabled === false ? 0 : 1);

  return {
    runId: real.runId,
    scenarioId: real.scenarioId,
    status,
    queuePosition: 0,
    createdAt: real.createdAt ?? new Date().toISOString(),
    elapsedMs: drillElapsedMs,
    durationMs: (real.drillParSeconds ?? 0) * 1000,
    ttlMs,
    renewable: real.renewable ?? false,
    deleting: real.status === "deleting",
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
    loadEnabled: loadGenerators > 0,
    loadGenerators,
    gatewayReplicas: real.gatewayReplicas ?? 1,
    canaryReplicas: real.canaryReplicas ?? 0,
    offeredRequestsPerSec: real.offeredRequestsPerSec ?? 0,
    restartToken: real.restartToken ?? "baseline",
    rankedActions: real.rankedActions ?? [],
    drillId,
    drillTitle: real.drillTitle ?? "",
    drillObjective: real.drillObjective ?? "",
    drillMode: real.drillMode ?? "",
    drillStage: real.drillStage ?? 0,
    drillStageCount: real.drillStageCount ?? 0,
    drillStageTitle: real.drillStageTitle ?? "",
    drillStageObjective: real.drillStageObjective ?? "",
    drillStageHandoff: real.drillStageHandoff ?? "",
    drillStageElapsedSeconds: real.drillStageElapsedSeconds ?? 0,
    drillParSeconds: real.drillParSeconds ?? 0,
    drillComplete: real.drillComplete ?? false,
    drillSolved: real.drillSolved ?? false,
    drillFailed: real.drillFailed ?? false,
    drillFailedMove: real.drillFailedMove ?? "",
    drillCorrectChosen: real.drillCorrectChosen ?? 0,
    drillCorrectTotal: real.drillCorrectTotal ?? 0,
    drillCorrectChosenAll: real.drillCorrectChosenAll ?? 0,
    drillCorrectTotalAll: real.drillCorrectTotalAll ?? 0,
    drillWrongChosen: real.drillWrongChosen ?? 0,
    drillOptions: real.drillOptions ?? [],
    drillGoals: real.drillGoals ?? [],
    drillHeldSeconds: real.drillHeldSeconds ?? 0,
    drillHoldSeconds: real.drillHoldSeconds ?? 0,
    rankedBriefing: real.rankedBriefing ?? null,
    rankedDebrief: real.rankedDebrief ?? null,
  };
}
