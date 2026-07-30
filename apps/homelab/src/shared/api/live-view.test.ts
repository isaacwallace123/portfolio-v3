import { describe, expect, it } from "vitest";
import { toLiveRunView, type RealRun } from "./live-view";

function run(telemetry: RealRun["telemetry"]): RealRun {
  return {
    runId: "run-hl-0123456789abcdef",
    scenarioId: "sandbox",
    status: "ready",
    namespace: "run-test",
    apiReplicas: 2,
    cacheEnabled: false,
    ttlSeconds: 900,
    renewable: true,
    telemetry,
  };
}

describe("live telemetry projection", () => {
  it("preserves withheld ranked gauges as null", () => {
    const view = toLiveRunView(
      run({
        podCount: 6,
        cpuMillicores: 120,
        memoryMiB: 256,
        postgresCpuPct: 20,
        requestsPerSec: null,
        p95LatencyMs: null,
        errorRatePct: null,
      }),
    );

    expect(view.measuredTelemetry).toEqual({
      requestsPerSec: null,
      p95LatencyMs: null,
      errorRatePct: null,
    });
  });

  it("keeps measured zero distinct from withheld", () => {
    const view = toLiveRunView(
      run({
        podCount: 6,
        cpuMillicores: 120,
        memoryMiB: 256,
        postgresCpuPct: 20,
        requestsPerSec: 0,
        p95LatencyMs: 0,
        errorRatePct: 0,
      }),
    );

    expect(view.measuredTelemetry).toEqual({
      requestsPerSec: 0,
      p95LatencyMs: 0,
      errorRatePct: 0,
    });
  });
});
