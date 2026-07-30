import { describe, expect, it } from "vitest";
import type {
  LiveRunView,
  LiveTrace,
  RunComponent,
} from "@/shared/api/live-client";
import { rankedLaunchReadiness } from "./launch";

const run = (overrides: Partial<LiveRunView> = {}) =>
  ({
    status: "running",
    deleting: false,
    namespace: "run-ranked",
    loadEnabled: true,
    offeredRequestsPerSec: 400,
    podCount: 3,
    telemetry: { requestsPerSec: 398 },
    ...overrides,
  }) as LiveRunView;

const component = (
  name: string,
  desired: number,
  ready: number,
): RunComponent => ({
  name,
  desired,
  ready,
  cpuMillicores: 20,
  memoryMiB: 64,
  cpuLimitMillicoresPerPod: 250,
  pods: Array.from({ length: desired }, (_, index) => ({
    name: `${name}-${index}`,
    phase: index < ready ? "Running" : "Pending",
    ready: index < ready,
    restarts: 0,
    cpuMillicores: index < ready ? 20 : 0,
    memoryMiB: index < ready ? 64 : 0,
    detail: index < ready ? "" : "ContainerCreating",
    pool: index < ready ? "apps" : "",
  })),
});

const trace = { spans: [{}] } as LiveTrace;

describe("ranked launch readiness", () => {
  it("does not activate before a run exists", () => {
    const state = rankedLaunchReadiness(null, [], null);
    expect(state.phase).toBe("allocating");
    expect(state.ready).toBe(false);
  });

  it("does not confuse one running pod with a playable cluster", () => {
    const state = rankedLaunchReadiness(
      run({ podCount: 1 }),
      [component("checkout", 2, 1), component("envoy", 1, 0)],
      null,
    );
    expect(state.phase).toBe("workloads");
    expect(state.readyPods).toBe(1);
    expect(state.desiredPods).toBe(3);
    expect(state.ready).toBe(false);
  });

  it("ignores intentionally disabled components", () => {
    const state = rankedLaunchReadiness(
      run(),
      [
        component("checkout", 2, 2),
        component("envoy", 1, 1),
        component("checkout-canary", 0, 0),
      ],
      trace,
    );
    expect(state.ready).toBe(true);
  });

  it("waits for measured traffic after every workload is ready", () => {
    const state = rankedLaunchReadiness(
      run({
        podCount: 3,
        telemetry: { requestsPerSec: 0 },
      } as Partial<LiveRunView>),
      [component("checkout", 2, 2), component("envoy", 1, 1)],
      null,
    );
    expect(state.phase).toBe("telemetry");
    expect(state.workloadsReady).toBe(true);
    expect(state.ready).toBe(false);
  });

  it("allows activation only after workloads and telemetry are measured", () => {
    const state = rankedLaunchReadiness(
      run(),
      [component("checkout", 2, 2), component("envoy", 1, 1)],
      trace,
    );
    expect(state.phase).toBe("ready");
    expect(state.ready).toBe(true);
  });
});
