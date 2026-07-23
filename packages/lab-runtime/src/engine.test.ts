import { beforeEach, describe, expect, it } from "vitest";
import { createRunEngine, type RunEngine } from "./engine";
import type { LabScenario } from ".";

const scenario: LabScenario = {
  id: "checkout-traffic-spike",
  lab: "homelab",
  title: "Keep checkout alive",
  eyebrow: "SRE drill 01",
  summary: "A three-tier workload takes a surge.",
  durationMs: 48_000,
  difficulty: "operator",
  resourceClass: "standard",
  decisions: [
    { id: "scale", label: "Scale API to 6", description: "", availableAfterMs: 15_000 },
    { id: "cache", label: "Enable cache", description: "", availableAfterMs: 18_000 },
    { id: "rollback", label: "Rollback", description: "", availableAfterMs: 20_000 },
  ],
  events: [
    { id: "a", offsetMs: 0, phase: "Provisioning", source: "ctl", title: "Admitted", detail: "", severity: "info" },
    { id: "b", offsetMs: 15_000, phase: "Incident", source: "k6", title: "Surge", detail: "", severity: "warning" },
    { id: "c", offsetMs: 46_000, phase: "Evidence", source: "ctl", title: "Sealed", detail: "", severity: "success" },
  ],
  telemetry: {
    kind: "traffic-spike",
    incidentStartMs: 15_000,
    incidentEndMs: 39_000,
    hpaAutoScaleAtMs: 31_000,
    latencyTargetMs: 120,
    baseline: { requestsPerSec: 118, p95LatencyMs: 43, errorRatePct: 0.02, apiReplicas: 3, postgresCpuPct: 34 },
    surgeRequestsPerSec: 942,
    recoveredRequestsPerSec: 684,
    scaledReplicas: 6,
    pressureLatencyMs: 684,
    cachedLatencyMs: 71,
    scaledLatencyMs: 104,
    nominalLatencyMs: 116,
    pressureErrorRatePct: 7.8,
    rollbackErrorRatePct: 0.08,
    nominalErrorRatePct: 0.21,
    pressurePostgresCpuPct: 86,
  },
};

// Controllable clock. Phase offsets from createdAt: queue 700, provision 900 -> running at 1600.
let clock = 0;
const RUN_START = 1_600;
function makeEngine(): RunEngine {
  return createRunEngine({ scenarios: [scenario], maxConcurrentRuns: 1, now: () => clock });
}

beforeEach(() => {
  clock = 1_000_000;
});

describe("lifecycle", () => {
  it("advances queued -> provisioning -> running -> collecting -> complete", () => {
    const engine = makeEngine();
    const created = engine.createRun({ scenarioId: scenario.id });
    expect("run" in created).toBe(true);
    const runId = ("run" in created ? created.run : null)!.runId;
    expect(engine.getRun(runId)!.status).toBe("queued");

    clock += 800; // > queue (700)
    expect(engine.getRun(runId)!.status).toBe("provisioning");

    clock = 1_000_000 + RUN_START + 5_000;
    expect(engine.getRun(runId)!.status).toBe("running");

    clock = 1_000_000 + RUN_START + scenario.durationMs + 100;
    expect(engine.getRun(runId)!.status).toBe("collecting");

    clock = 1_000_000 + RUN_START + scenario.durationMs + 2_000;
    const view = engine.getRun(runId)!;
    expect(view.status).toBe("complete");
    expect(view.reportReady).toBe(true);
  });
});

describe("capacity", () => {
  it("rejects a second concurrent run and frees the slot after completion", () => {
    const engine = makeEngine();
    engine.createRun({ scenarioId: scenario.id });
    const second = engine.createRun({ scenarioId: scenario.id });
    expect("error" in second && second.error.code).toBe("at_capacity");

    clock = 1_000_000 + RUN_START + scenario.durationMs + 5_000; // first run complete
    const third = engine.createRun({ scenarioId: scenario.id });
    expect("run" in third).toBe(true);
  });
});

describe("idempotency", () => {
  it("returns the same run for a repeated idempotency key", () => {
    const engine = makeEngine();
    const a = engine.createRun({ scenarioId: scenario.id, idempotencyKey: "k1" });
    const b = engine.createRun({ scenarioId: scenario.id, idempotencyKey: "k1" });
    const idA = ("run" in a ? a.run : null)!.runId;
    const idB = ("run" in b ? b.run : null)!.runId;
    expect(idB).toBe(idA);
  });
});

describe("decisions", () => {
  it("rejects a decision before it is available, accepts it during the incident", () => {
    const engine = makeEngine();
    const runId = (engine.createRun({ scenarioId: scenario.id }) as { run: { runId: string } }).run.runId;

    clock = 1_000_000 + RUN_START + 5_000; // running, elapsed 5s < 15s
    const early = engine.submitDecision(runId, "scale");
    expect("error" in early && early.error.code).toBe("decision_unavailable");

    clock = 1_000_000 + RUN_START + 16_000; // elapsed 16s >= 15s
    const ok = engine.submitDecision(runId, "scale");
    expect("run" in ok).toBe(true);
    expect(engine.getRun(runId)!.acceptedDecisions.map((d) => d.id)).toContain("scale");
  });

  it("keeps latency in budget after scaling but burns SLO when unmitigated", () => {
    const engine = makeEngine();
    const runId = (engine.createRun({ scenarioId: scenario.id }) as { run: { runId: string } }).run.runId;

    // Unmitigated, mid-incident: pressure telemetry.
    clock = 1_000_000 + RUN_START + 20_000;
    const pressured = engine.getRun(runId)!.telemetry;
    expect(pressured.p95LatencyMs).toBe(684);
    expect(pressured.errorRatePct).toBeGreaterThan(1);

    // Scale, then re-read: latency recovers, errors drop.
    engine.submitDecision(runId, "scale");
    const scaled = engine.getRun(runId)!.telemetry;
    expect(scaled.apiReplicas).toBe(6);
    expect(scaled.p95LatencyMs).toBeLessThan(120);
    expect(scaled.errorRatePct).toBeLessThan(1);
  });
});

describe("report", () => {
  it("is null until complete, then scores a clean mitigated run as passed", () => {
    const engine = makeEngine();
    const runId = (engine.createRun({ scenarioId: scenario.id }) as { run: { runId: string } }).run.runId;

    clock = 1_000_000 + RUN_START + 19_000; // both scale (15s) and cache (18s) available
    engine.submitDecision(runId, "scale");
    engine.submitDecision(runId, "cache");
    expect(engine.getReport(runId)).toBeNull(); // still running

    clock = 1_000_000 + RUN_START + scenario.durationMs + 5_000;
    const report = engine.getReport(runId)!;
    expect(report).not.toBeNull();
    expect(report.outcome).toBe("passed"); // ended healthy
    expect(report.decisions.map((d) => d.id)).toEqual(["scale", "cache"]);
    expect(report.telemetry.peakRequestsPerSec).toBe(942);
    // Faithful: the seconds of burn before the operator scaled are reflected, not applied backwards.
    expect(report.telemetry.worstLatencyMs).toBe(684);
    expect(report.sloHeldPct).toBeGreaterThan(80);
    expect(report.sloHeldPct).toBeLessThan(100);
  });
});
