// Public run-controller contract for the homelab Operations Arena.
//
// This mirrors docs/public-operations-arena.md in the homelab repository. The frontend and its BFF
// speak these shapes ONLY; they never see Kubernetes objects. The in-memory engine in engine.ts is
// the reference implementation. The production engine will translate createRun() into a Crossplane
// `LabRun` claim and project sanitized cluster state back into these same shapes — the contract is
// intentionally independent of Kubernetes so that swap changes nothing above this line.

import type { EventSeverity, LabKind, RunEvent } from "./index";

// Run lifecycle from the public contract:
//   queued -> provisioning -> running -> collecting -> complete
// with `failed` and `expired` as terminal states. (`idle` is a client-only pre-run state and is
// deliberately NOT part of the server contract.)
export type RunPhase =
  | "queued"
  | "provisioning"
  | "running"
  | "collecting"
  | "complete"
  | "failed"
  | "expired";

export const TERMINAL_PHASES: readonly RunPhase[] = [
  "complete",
  "failed",
  "expired",
];

export function isTerminalPhase(phase: RunPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

// Sanitized, allowlisted telemetry projection. These are the only numbers a public browser sees.
// No pod names, node names, labels, env, image tags, or raw PromQL — just the demo's shaped signals.
export interface RunTelemetry {
  requestsPerSec: number;
  p95LatencyMs: number;
  latencyTargetMs: number;
  errorRatePct: number;
  apiReplicas: number;
  postgresCpuPct: number;
  cacheActive: boolean;
  score: number;
}

// Deterministic model that the encoder uses to derive telemetry from run-elapsed time and the set
// of accepted operator decisions. Carried on the scenario so new scenarios ship their own model
// instead of hard-coding numbers in the engine.
export interface TrafficTelemetryModel {
  kind: "traffic-spike";
  incidentStartMs: number;
  incidentEndMs: number;
  hpaAutoScaleAtMs: number;
  latencyTargetMs: number;
  baseline: {
    requestsPerSec: number;
    p95LatencyMs: number;
    errorRatePct: number;
    apiReplicas: number;
    postgresCpuPct: number;
  };
  surgeRequestsPerSec: number;
  recoveredRequestsPerSec: number;
  scaledReplicas: number;
  // Latency (ms) once the incident is under way, keyed by which mitigation is active.
  pressureLatencyMs: number; // no mitigation
  cachedLatencyMs: number; // response cache enabled
  scaledLatencyMs: number; // extra replicas only
  nominalLatencyMs: number; // recovered / mitigated baseline
  pressureErrorRatePct: number;
  rollbackErrorRatePct: number;
  nominalErrorRatePct: number;
  pressurePostgresCpuPct: number;
}

export type TelemetryModel = TrafficTelemetryModel;

// Public scenario metadata (GET /api/v1/scenarios). A subset of LabScenario with no runtime model.
export interface ScenarioSummary {
  id: string;
  lab: LabKind;
  title: string;
  eyebrow: string;
  summary: string;
  difficulty: "guided" | "operator" | "expert";
  resourceClass: "light" | "standard" | "heavy";
  estimatedDurationMs: number;
  decisions: {
    id: string;
    label: string;
    description: string;
    availableAfterMs: number;
  }[];
}

export interface Capacity {
  maxConcurrentRuns: number;
  activeRuns: number;
  slotsAvailable: number;
  queueDepth: number;
  vcpu: number;
  memoryGiB: number;
  runTtlMs: number;
}

export interface ScenarioCatalog {
  scenarios: ScenarioSummary[];
  capacity: Capacity;
}

export interface AcceptedDecision {
  id: string;
  label: string;
  acceptedAtMs: number; // run-elapsed offset at which it was accepted
}

// GET /api/v1/runs/{runId}. The complete sanitized read model the UI renders from.
export interface RunView {
  runId: string;
  scenarioId: string;
  status: RunPhase;
  queuePosition: number; // 0 once admitted
  createdAt: string; // ISO 8601
  elapsedMs: number; // run-phase elapsed, clamped to duration
  durationMs: number;
  ttlMs: number;
  remainingTtlMs: number;
  telemetry: RunTelemetry;
  visibleEvents: RunEvent[];
  acceptedDecisions: AcceptedDecision[];
  availableDecisions: string[]; // decision ids acceptable right now
  complete: boolean;
  reportReady: boolean;
}

// Typed SSE envelope for GET /api/v1/runs/{runId}/events. `snapshot` carries the full RunView each
// tick; `lifecycle` and `decision` are discrete deltas emitted on transition. All are projections.
export type RunEventEnvelope =
  | { type: "snapshot"; seq: number; at: string; run: RunView }
  | {
      type: "lifecycle";
      seq: number;
      at: string;
      runId: string;
      status: RunPhase;
    }
  | {
      type: "decision";
      seq: number;
      at: string;
      runId: string;
      decision: AcceptedDecision;
    }
  | { type: "report-ready"; seq: number; at: string; runId: string };

export interface ReportFinding {
  label: string;
  detail: string;
  severity: EventSeverity;
}

// GET /api/v1/runs/{runId}/report — the published, sanitized after-action report.
export interface AfterActionReport {
  runId: string;
  scenarioId: string;
  title: string;
  outcome: "passed" | "degraded" | "failed";
  score: number;
  sloHeldPct: number;
  durationMs: number;
  decisions: AcceptedDecision[];
  timeline: RunEvent[];
  findings: ReportFinding[];
  telemetry: {
    peakRequestsPerSec: number;
    worstLatencyMs: number;
    worstErrorRatePct: number;
  };
  sealedAt: string; // ISO 8601
}

export type CreateRunError =
  | { code: "unknown_scenario"; status: 404; message: string }
  | { code: "at_capacity"; status: 429; message: string }
  | { code: "invalid_request"; status: 400; message: string };

export type DecisionError =
  | { code: "unknown_run"; status: 404; message: string }
  | { code: "unknown_decision"; status: 404; message: string }
  | { code: "decision_unavailable"; status: 409; message: string };
