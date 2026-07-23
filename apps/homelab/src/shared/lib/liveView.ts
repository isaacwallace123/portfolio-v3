import {
  computeTelemetry,
  getRunSnapshot,
  type RunTelemetry,
  type RunView,
} from "@iw/lab-runtime";
import { trafficSpikeScenario } from "@/entities/scenario";

// Merge a REAL cluster run with the scenario's modeled incident so the arena renders exactly as
// designed while the infrastructure underneath is genuinely live. The run is real (a Crossplane
// LabRun → disposable namespace + workload); the traffic-spike *incident* is a scripted drill played
// on a clock. Operator decisions have BOTH effects: real (checkout actually scales, the Redis tier
// actually comes up) and narrative (latency/error curves respond in the model).
//
// Real signals always win over the model where they overlap (apiReplicas, cache), so the topology
// and decisions reflect the cluster, not a simulation.

// Real provisioning takes ~15s before the incident clock should start.
const PROVISION_MS = 16_000;
const REAL_DECISIONS = new Set(["scale", "cache"]); // rollback has no real workload yet

export interface RealRun {
  runId: string;
  scenarioId: string;
  status: string; // provisioning | ready | deleting
  namespace: string | null;
  apiReplicas: number;
  cacheEnabled: boolean;
  ttlSeconds: number;
  createdAt?: string;
  telemetry?: {
    podCount: number;
    cpuMillicores: number;
    memoryMiB: number;
  } | null;
}

// RunView plus the real cluster facts the arena surfaces (namespace, measured usage).
export interface LiveRunView extends RunView {
  live: true;
  namespace: string | null;
  podCount: number | null;
  cpuMillicores: number | null;
  memoryMiB: number | null;
}

export function toLiveRunView(real: RealRun): LiveRunView {
  const scenario = trafficSpikeScenario;
  const createdMs = real.createdAt ? Date.parse(real.createdAt) : Date.now();
  const narrativeElapsed = Math.max(
    0,
    Math.min(Date.now() - createdMs - PROVISION_MS, scenario.durationMs),
  );

  // Derive which operator decisions are in effect from the real LabRun spec.
  const accepted = new Set<string>();
  if (real.apiReplicas >= 6) accepted.add("scale");
  if (real.cacheEnabled) accepted.add("cache");

  const model = computeTelemetry(scenario, narrativeElapsed, accepted);
  const snap = getRunSnapshot(scenario, narrativeElapsed);

  // Treat the run as "running" once its pods are measured, not only when the LabRun's Ready condition
  // flips (that lags Crossplane reconciliation by up to a minute).
  const podsUp = (real.telemetry?.podCount ?? 0) > 0;
  const status: RunView["status"] =
    real.status === "deleting"
      ? "collecting"
      : real.status === "ready" || podsUp
        ? "running"
        : "provisioning";

  // Model drives the incident signals; real cluster state overrides replicas + cache.
  const telemetry: RunTelemetry = {
    ...model,
    apiReplicas: real.apiReplicas,
    cacheActive: real.cacheEnabled,
  };

  const acceptedDecisions = [...accepted].map((id) => {
    const d = scenario.decisions.find((x) => x.id === id);
    return { id, label: d?.label ?? id, acceptedAtMs: d?.availableAfterMs ?? 0 };
  });

  // Decisions unlock on the incident clock (a scripted drill), not the laggy Ready condition — the
  // real patch applies fine as long as the LabRun exists.
  const availableDecisions =
    status === "collecting"
      ? []
      : scenario.decisions
          .filter(
            (d) =>
              REAL_DECISIONS.has(d.id) &&
              narrativeElapsed >= d.availableAfterMs &&
              !accepted.has(d.id),
          )
          .map((d) => d.id);

  const ttlMs = real.ttlSeconds * 1000;
  return {
    runId: real.runId,
    scenarioId: real.scenarioId,
    status,
    queuePosition: 0,
    createdAt: real.createdAt ?? new Date().toISOString(),
    elapsedMs: narrativeElapsed,
    durationMs: scenario.durationMs,
    ttlMs,
    remainingTtlMs: Math.max(0, ttlMs - (Date.now() - createdMs)),
    telemetry,
    visibleEvents: snap.visibleEvents,
    acceptedDecisions,
    availableDecisions,
    complete: false,
    reportReady: false,
    live: true,
    namespace: real.namespace,
    podCount: real.telemetry?.podCount ?? null,
    cpuMillicores: real.telemetry?.cpuMillicores ?? null,
    memoryMiB: real.telemetry?.memoryMiB ?? null,
  };
}
