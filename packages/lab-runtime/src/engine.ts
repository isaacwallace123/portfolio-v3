// Reference RunEngine — the seam between the public contract and whatever provisions real runs.
//
// TODAY: a deterministic in-memory engine. A run's entire state is a function of its creation time,
// the scenario's timeline, and the operator decisions accepted so far; nothing is stored except the
// creation timestamp and the decision list, so the same inputs always yield the same projection.
//
// TOMORROW (homelab repo, Crossplane): `createRun` creates a `LabRun` claim; a Composition provisions
// the disposable namespace + ResourceQuota + LimitRange + NetworkPolicy + workload with a hard TTL;
// `getRun`/`streamRun` project sanitized cluster state into these same RunView/RunTelemetry shapes;
// `submitDecision` patches the claim's allowlisted decision field; teardown = delete the claim.
// Everything above the RunEngine interface is unaffected by that swap.

import type { LabScenario, RunEvent } from "./index";
import { getRunSnapshot } from "./index";
import type {
  AcceptedDecision,
  AfterActionReport,
  Capacity,
  CreateRunError,
  DecisionError,
  RunPhase,
  RunTelemetry,
  RunView,
  ScenarioCatalog,
  ScenarioSummary,
  TrafficTelemetryModel,
} from "./contract";
import { isTerminalPhase } from "./contract";

// Lifecycle timing (ms) for the phases that bracket the scenario's own running window.
const QUEUE_MS = 700;
const PROVISION_MS = 900;
const COLLECT_MS = 1_100;

export interface RunEngineConfig {
  scenarios: LabScenario[];
  maxConcurrentRuns?: number;
  runTtlMs?: number;
  vcpu?: number;
  memoryGiB?: number;
  now?: () => number; // injectable clock for deterministic tests
}

interface RunRecord {
  runId: string;
  scenarioId: string;
  createdAt: number; // epoch ms
  idempotencyKey?: string;
  requestedBy: string;
  decisions: AcceptedDecision[];
}

export interface CreateRunInput {
  scenarioId: string;
  idempotencyKey?: string;
  requestedBy?: string;
}

export interface RunEngine {
  listScenarios(): ScenarioCatalog;
  createRun(
    input: CreateRunInput,
  ): { run: RunView } | { error: CreateRunError };
  getRun(runId: string): RunView | null;
  submitDecision(
    runId: string,
    decisionId: string,
  ): { run: RunView } | { error: DecisionError };
  getReport(runId: string): AfterActionReport | null;
}

export function scenarioToSummary(scenario: LabScenario): ScenarioSummary {
  return {
    id: scenario.id,
    lab: scenario.lab,
    title: scenario.title,
    eyebrow: scenario.eyebrow,
    summary: scenario.summary,
    difficulty: scenario.difficulty,
    resourceClass: scenario.resourceClass,
    estimatedDurationMs: scenario.durationMs,
    decisions: scenario.decisions.map((d) => ({
      id: d.id,
      label: d.label,
      description: d.description,
      availableAfterMs: d.availableAfterMs,
    })),
  };
}

// ---- telemetry encoder -------------------------------------------------------------------------

// Derive the sanitized telemetry projection from run-elapsed time and accepted decisions. Pure and
// deterministic: this is the "allowlisted projection" the contract requires instead of raw signals.
export function computeTelemetry(
  scenario: LabScenario,
  elapsedRunMs: number,
  acceptedIds: ReadonlySet<string>,
): RunTelemetry {
  const model = scenario.telemetry;
  if (!model || model.kind !== "traffic-spike") {
    // Scenario without a telemetry model: report a flat, healthy baseline.
    return {
      requestsPerSec: 0,
      p95LatencyMs: 0,
      latencyTargetMs: 0,
      errorRatePct: 0,
      apiReplicas: 0,
      postgresCpuPct: 0,
      cacheActive: false,
      score: 100,
    };
  }
  return computeTrafficTelemetry(model, elapsedRunMs, acceptedIds);
}

function computeTrafficTelemetry(
  m: TrafficTelemetryModel,
  e: number,
  accepted: ReadonlySet<string>,
): RunTelemetry {
  const preIncident = e < m.incidentStartMs;
  const scaled = accepted.has("scale") || e >= m.hpaAutoScaleAtMs;
  const cached = accepted.has("cache");
  const rolledBack = accepted.has("rollback");
  const inIncident = e >= m.incidentStartMs && e < m.incidentEndMs;
  const pressure = inIncident && !scaled && !cached && !rolledBack;

  const requestsPerSec = preIncident
    ? m.baseline.requestsPerSec
    : e < m.incidentEndMs
      ? m.surgeRequestsPerSec
      : m.recoveredRequestsPerSec;

  const p95LatencyMs = preIncident
    ? m.baseline.p95LatencyMs
    : pressure
      ? m.pressureLatencyMs
      : cached
        ? m.cachedLatencyMs
        : scaled
          ? m.scaledLatencyMs
          : m.nominalLatencyMs;

  const errorRatePct = preIncident
    ? m.baseline.errorRatePct
    : pressure
      ? m.pressureErrorRatePct
      : rolledBack
        ? m.rollbackErrorRatePct
        : m.nominalErrorRatePct;

  // Score: full marks minus an SLO-burn penalty while unmitigated, minus an inaction penalty if the
  // operator has done nothing well past the incident onset. Derived — not a stored counter.
  let score = 100;
  if (pressure) score -= 31;
  if (e > m.incidentStartMs + 10_000 && accepted.size === 0) score -= 12;
  score = Math.max(0, score);

  return {
    requestsPerSec,
    p95LatencyMs,
    latencyTargetMs: m.latencyTargetMs,
    errorRatePct,
    apiReplicas: scaled ? m.scaledReplicas : m.baseline.apiReplicas,
    postgresCpuPct: pressure ? m.pressurePostgresCpuPct : m.baseline.postgresCpuPct,
    cacheActive: cached,
    score,
  };
}

// ---- engine ------------------------------------------------------------------------------------

export function createRunEngine(config: RunEngineConfig): RunEngine {
  const scenarios = new Map(config.scenarios.map((s) => [s.id, s]));
  const maxConcurrentRuns = config.maxConcurrentRuns ?? 1;
  const runTtlMs = config.runTtlMs ?? 15 * 60_000;
  const vcpu = config.vcpu ?? 4;
  const memoryGiB = config.memoryGiB ?? 6;
  const now = config.now ?? Date.now;

  const runs = new Map<string, RunRecord>();
  const byIdempotencyKey = new Map<string, string>();
  let counter = 0;

  function phaseTimeline(record: RunRecord, scenario: LabScenario) {
    const provisioningAt = record.createdAt + QUEUE_MS;
    const runningAt = provisioningAt + PROVISION_MS;
    const collectingAt = runningAt + scenario.durationMs;
    const completeAt = collectingAt + COLLECT_MS;
    return { provisioningAt, runningAt, collectingAt, completeAt };
  }

  function statusOf(record: RunRecord, scenario: LabScenario, t: number): RunPhase {
    const { provisioningAt, runningAt, collectingAt, completeAt } =
      phaseTimeline(record, scenario);
    if (t >= completeAt) return "complete";
    // Hard TTL guard: a run that has not completed within its TTL is expired. In the deterministic
    // engine this never fires; the real controller relies on it as the isolation backstop.
    if (t - record.createdAt > runTtlMs) return "expired";
    if (t < provisioningAt) return "queued";
    if (t < runningAt) return "provisioning";
    if (t < collectingAt) return "running";
    return "collecting";
  }

  function elapsedRunMs(
    record: RunRecord,
    scenario: LabScenario,
    t: number,
  ): number {
    const { runningAt } = phaseTimeline(record, scenario);
    return Math.max(0, Math.min(t - runningAt, scenario.durationMs));
  }

  function activeRunCount(t: number): number {
    let active = 0;
    for (const record of runs.values()) {
      const scenario = scenarios.get(record.scenarioId);
      if (!scenario) continue;
      if (!isTerminalPhase(statusOf(record, scenario, t))) active += 1;
    }
    return active;
  }

  function toView(record: RunRecord, scenario: LabScenario, t: number): RunView {
    const status = statusOf(record, scenario, t);
    const elapsed = elapsedRunMs(record, scenario, t);
    const acceptedIds = new Set(record.decisions.map((d) => d.id));
    const telemetry = computeTelemetry(scenario, elapsed, acceptedIds);

    // Feed events: reuse the fixture snapshot's offset-gated reveal for the running window; before
    // running there are none, and terminal runs show the full timeline.
    let visibleEvents: RunEvent[] = [];
    if (status === "running" || status === "collecting") {
      visibleEvents = getRunSnapshot(scenario, elapsed).visibleEvents;
    } else if (isTerminalPhase(status)) {
      visibleEvents = scenario.events;
    }

    const availableDecisions =
      status === "running"
        ? scenario.decisions
            .filter(
              (d) => elapsed >= d.availableAfterMs && !acceptedIds.has(d.id),
            )
            .map((d) => d.id)
        : [];

    const remainingTtlMs = Math.max(0, runTtlMs - (t - record.createdAt));

    return {
      runId: record.runId,
      scenarioId: record.scenarioId,
      status,
      queuePosition: 0,
      createdAt: new Date(record.createdAt).toISOString(),
      elapsedMs: elapsed,
      durationMs: scenario.durationMs,
      ttlMs: runTtlMs,
      remainingTtlMs,
      telemetry,
      visibleEvents,
      acceptedDecisions: record.decisions,
      availableDecisions,
      complete: status === "complete",
      reportReady: status === "complete",
    };
  }

  return {
    listScenarios(): ScenarioCatalog {
      const t = now();
      const active = activeRunCount(t);
      const capacity: Capacity = {
        maxConcurrentRuns,
        activeRuns: active,
        slotsAvailable: Math.max(0, maxConcurrentRuns - active),
        queueDepth: 0,
        vcpu,
        memoryGiB,
        runTtlMs,
      };
      return {
        scenarios: config.scenarios.map(scenarioToSummary),
        capacity,
      };
    },

    createRun(input) {
      const t = now();
      const scenario = scenarios.get(input.scenarioId);
      if (!scenario) {
        return {
          error: {
            code: "unknown_scenario",
            status: 404,
            message: `Unknown scenario '${input.scenarioId}'.`,
          },
        };
      }

      // Idempotency: replaying the same key returns the existing run instead of creating another.
      if (input.idempotencyKey) {
        const existingId = byIdempotencyKey.get(input.idempotencyKey);
        if (existingId) {
          const existing = runs.get(existingId);
          if (existing) return { run: toView(existing, scenario, t) };
        }
      }

      if (activeRunCount(t) >= maxConcurrentRuns) {
        return {
          error: {
            code: "at_capacity",
            status: 429,
            message: "No drill slots are free. Try again shortly.",
          },
        };
      }

      counter += 1;
      const runId = `run-hl-${t.toString(36)}-${counter.toString(36)}`;
      const record: RunRecord = {
        runId,
        scenarioId: scenario.id,
        createdAt: t,
        idempotencyKey: input.idempotencyKey,
        requestedBy: (input.requestedBy ?? "guest").slice(0, 40),
        decisions: [],
      };
      runs.set(runId, record);
      if (input.idempotencyKey) byIdempotencyKey.set(input.idempotencyKey, runId);
      return { run: toView(record, scenario, t) };
    },

    getRun(runId) {
      const record = runs.get(runId);
      if (!record) return null;
      const scenario = scenarios.get(record.scenarioId);
      if (!scenario) return null;
      return toView(record, scenario, now());
    },

    submitDecision(runId, decisionId) {
      const t = now();
      const record = runs.get(runId);
      if (!record) {
        return {
          error: {
            code: "unknown_run",
            status: 404,
            message: `Unknown run '${runId}'.`,
          },
        };
      }
      const scenario = scenarios.get(record.scenarioId);
      if (!scenario) {
        return {
          error: {
            code: "unknown_run",
            status: 404,
            message: `Unknown run '${runId}'.`,
          },
        };
      }
      const decision = scenario.decisions.find((d) => d.id === decisionId);
      if (!decision) {
        return {
          error: {
            code: "unknown_decision",
            status: 404,
            message: `Decision '${decisionId}' is not part of this scenario.`,
          },
        };
      }
      if (record.decisions.some((d) => d.id === decisionId)) {
        return { run: toView(record, scenario, t) }; // idempotent re-accept
      }
      const status = statusOf(record, scenario, t);
      const elapsed = elapsedRunMs(record, scenario, t);
      if (status !== "running" || elapsed < decision.availableAfterMs) {
        return {
          error: {
            code: "decision_unavailable",
            status: 409,
            message: `Decision '${decisionId}' is not available yet.`,
          },
        };
      }
      record.decisions.push({
        id: decision.id,
        label: decision.label,
        acceptedAtMs: elapsed,
      });
      return { run: toView(record, scenario, t) };
    },

    getReport(runId) {
      const record = runs.get(runId);
      if (!record) return null;
      const scenario = scenarios.get(record.scenarioId);
      if (!scenario) return null;
      const status = statusOf(record, scenario, now());
      if (status !== "complete") return null;
      return buildReport(record, scenario);
    },
  };
}

function buildReport(
  record: RunRecord,
  scenario: LabScenario,
): AfterActionReport {
  const acceptedIds = new Set(record.decisions.map((d) => d.id));

  // Sample the run at 1s resolution to find the true worst-case signals. Each decision only takes
  // effect from the instant it was accepted, so a slow response is faithfully reflected as burn —
  // the report is honest about what actually happened, not the final configuration applied backwards.
  let peakRequestsPerSec = 0;
  let worstLatencyMs = 0;
  let worstErrorRatePct = 0;
  let held = 0;
  let samples = 0;
  const target = scenario.telemetry?.latencyTargetMs ?? Infinity;
  for (let e = 0; e <= scenario.durationMs; e += 1_000) {
    const effective = new Set(
      record.decisions.filter((d) => d.acceptedAtMs <= e).map((d) => d.id),
    );
    const tel = computeTelemetry(scenario, e, effective);
    peakRequestsPerSec = Math.max(peakRequestsPerSec, tel.requestsPerSec);
    worstLatencyMs = Math.max(worstLatencyMs, tel.p95LatencyMs);
    worstErrorRatePct = Math.max(worstErrorRatePct, tel.errorRatePct);
    if (tel.errorRatePct < 1 && tel.p95LatencyMs <= target) held += 1;
    samples += 1;
  }
  const sloHeldPct = samples === 0 ? 100 : Math.round((held / samples) * 100);
  // Headline score reflects the end state (did the operator leave the platform healthy), consistent
  // with the live "Run score" metric.
  const finalScore = computeTelemetry(
    scenario,
    scenario.durationMs,
    acceptedIds,
  ).score;

  const outcome: AfterActionReport["outcome"] =
    finalScore >= 85 ? "passed" : finalScore >= 60 ? "degraded" : "failed";

  const findings: AfterActionReport["findings"] = [];
  if (worstErrorRatePct >= 1) {
    findings.push({
      label: "Error budget was spent",
      detail: `5xx rate reached ${worstErrorRatePct.toFixed(1)}% before mitigation.`,
      severity: "critical",
    });
  } else {
    findings.push({
      label: "SLO held",
      detail: `Error rate stayed under 1% for the entire run.`,
      severity: "success",
    });
  }
  if (acceptedIds.has("scale")) {
    findings.push({
      label: "Scaled ahead of the autoscaler",
      detail: "Operator added capacity before the HPA reconciliation window.",
      severity: "info",
    });
  }
  if (acceptedIds.has("cache")) {
    findings.push({
      label: "Shed read load to cache",
      detail: "Catalogue reads were served from Redis, relieving Postgres.",
      severity: "info",
    });
  }
  if (record.decisions.length === 0) {
    findings.push({
      label: "No operator intervention",
      detail: "The run recovered on autoscaling alone; latency stayed elevated longer.",
      severity: "warning",
    });
  }

  return {
    runId: record.runId,
    scenarioId: scenario.id,
    title: scenario.title,
    outcome,
    score: finalScore,
    sloHeldPct,
    durationMs: scenario.durationMs,
    decisions: record.decisions,
    timeline: scenario.events,
    findings,
    telemetry: { peakRequestsPerSec, worstLatencyMs, worstErrorRatePct },
    sealedAt: new Date(record.createdAt + scenario.durationMs).toISOString(),
  };
}
