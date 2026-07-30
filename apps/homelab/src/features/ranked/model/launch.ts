import type {
  LiveRunView,
  LiveTrace,
  RunComponent,
} from "@/shared/api/live-client";

export type RankedLaunchPhase =
  "allocating" | "workloads" | "telemetry" | "activating" | "ready";

export interface RankedLaunchReadiness {
  phase: RankedLaunchPhase;
  ready: boolean;
  namespaceReady: boolean;
  workloadsReady: boolean;
  telemetryReady: boolean;
  readyPods: number;
  desiredPods: number;
  detail: string;
}

/**
 * A ranked attempt must not exist until the disposable environment is playable.
 * This projection deliberately uses measured snapshot data rather than the run's
 * broad "running" status, which becomes true as soon as the first pod appears.
 */
export function rankedLaunchReadiness(
  run: LiveRunView | null,
  components: RunComponent[],
  trace: LiveTrace | null,
): RankedLaunchReadiness {
  if (!run) {
    return {
      phase: "allocating",
      ready: false,
      namespaceReady: false,
      workloadsReady: false,
      telemetryReady: false,
      readyPods: 0,
      desiredPods: 0,
      detail: "Allocating an isolated namespace and scoped service account.",
    };
  }

  const namespaceReady =
    run.status !== "provisioning" && !run.deleting && Boolean(run.namespace);
  const desired = components.filter((component) => component.desired > 0);
  const desiredPods = desired.reduce(
    (total, component) => total + component.desired,
    0,
  );
  const readyPods = desired.reduce(
    (total, component) => total + Math.min(component.ready, component.desired),
    0,
  );
  const workloadsReady =
    namespaceReady &&
    desired.length > 0 &&
    desiredPods > 0 &&
    desired.every(
      (component) =>
        component.ready >= component.desired &&
        component.pods.filter((pod) => pod.ready).length >= component.desired,
    );

  const trafficExpected = run.loadEnabled && run.offeredRequestsPerSec > 0;
  const measuredPods =
    run.podCount !== null && run.podCount >= desiredPods && desiredPods > 0;
  const trafficMeasured =
    !trafficExpected || run.telemetry.requestsPerSec > 0 || trace !== null;
  const telemetryReady = workloadsReady && measuredPods && trafficMeasured;

  if (!namespaceReady) {
    return {
      phase: "allocating",
      ready: false,
      namespaceReady,
      workloadsReady,
      telemetryReady,
      readyPods,
      desiredPods,
      detail: "Creating the isolated cluster boundary.",
    };
  }

  if (!workloadsReady) {
    return {
      phase: "workloads",
      ready: false,
      namespaceReady,
      workloadsReady,
      telemetryReady,
      readyPods,
      desiredPods,
      detail:
        desiredPods > 0
          ? `Waiting for workloads: ${readyPods} of ${desiredPods} pods ready.`
          : "Waiting for the workload plan from the cluster.",
    };
  }

  if (!telemetryReady) {
    return {
      phase: "telemetry",
      ready: false,
      namespaceReady,
      workloadsReady,
      telemetryReady,
      readyPods,
      desiredPods,
      detail: "Verifying live traffic, metrics, and the request path.",
    };
  }

  return {
    phase: "ready",
    ready: true,
    namespaceReady,
    workloadsReady,
    telemetryReady,
    readyPods,
    desiredPods,
    detail: "Environment verified. Activating the hidden incident.",
  };
}
