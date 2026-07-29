import type { LabScenario } from "@iw/lab-runtime";

const commonTelemetry = {
  kind: "traffic-spike" as const,
  incidentStartMs: 15_000,
  incidentEndMs: 52_000,
  hpaAutoScaleAtMs: 45_000,
  latencyTargetMs: 120,
  baseline: {
    requestsPerSec: 118,
    p95LatencyMs: 43,
    errorRatePct: 0.02,
    apiReplicas: 3,
    postgresCpuPct: 34,
  },
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
};

export const trafficSpikeScenario: LabScenario = {
  id: "checkout-traffic-spike",
  lab: "homelab",
  title: "Keep checkout alive",
  eyebrow: "SRE drill 01",
  summary:
    "A real three-tier workload takes a sudden traffic surge. Read the signals, make an intervention, and preserve the SLO.",
  durationMs: 64_000,
  difficulty: "operator",
  resourceClass: "standard",
  telemetry: commonTelemetry,
  decisions: [
    {
      id: "scale",
      label: "Scale API to 6",
      description: "Add capacity now instead of waiting for the HPA window.",
      availableAfterMs: 15_000,
    },
    {
      id: "cache",
      label: "Enable response cache",
      description: "Shift repeated catalogue reads away from Postgres.",
      availableAfterMs: 18_000,
    },
  ],
  events: [
    {
      id: "accepted",
      offsetMs: 0,
      phase: "Provisioning",
      source: "run-controller",
      title: "Run admitted",
      detail: "A bounded namespace and resource envelope were requested.",
      severity: "info",
    },
    {
      id: "gitops",
      offsetMs: 4_000,
      phase: "Provisioning",
      source: "crossplane",
      title: "Desired state composed",
      detail:
        "Quota, network policy, services, and deployments are reconciling.",
      severity: "success",
    },
    {
      id: "warm",
      offsetMs: 9_000,
      phase: "Baseline",
      source: "load-generator",
      title: "Baseline established",
      detail: "The closed-loop traffic profile is active through Envoy.",
      severity: "success",
    },
    {
      id: "surge",
      offsetMs: 15_000,
      phase: "Incident",
      source: "k6",
      title: "Traffic pressure applied",
      detail: "Checkout connections are queuing behind the database pool.",
      severity: "warning",
    },
    {
      id: "saturation",
      offsetMs: 22_000,
      phase: "Incident",
      source: "prometheus",
      title: "Checkout SLO is burning",
      detail: "Measured p95 latency and failed requests crossed the objective.",
      severity: "critical",
    },
    {
      id: "recovered",
      offsetMs: 52_000,
      phase: "Recovery",
      source: "slo-controller",
      title: "Recovery window evaluated",
      detail:
        "The controller is checking whether the service is back in budget.",
      severity: "success",
    },
    {
      id: "evidence",
      offsetMs: 61_000,
      phase: "Evidence",
      source: "run-controller",
      title: "Evidence bundle sealed",
      detail:
        "Metrics, spans, decisions, and Kubernetes events were collected.",
      severity: "success",
    },
  ],
};

export const badReleaseScenario: LabScenario = {
  id: "checkout-bad-release",
  lab: "homelab",
  title: "Ship a bad release",
  eyebrow: "SRE drill 02",
  summary:
    "A candidate checkout build introduces a pricing-path regression. Find the slow span and roll back before the error budget is exhausted.",
  durationMs: 64_000,
  difficulty: "operator",
  resourceClass: "standard",
  telemetry: {
    ...commonTelemetry,
    incidentStartMs: 10_000,
    incidentEndMs: 52_000,
    pressureLatencyMs: 520,
    pressureErrorRatePct: 9.5,
  },
  decisions: [
    {
      id: "rollback",
      label: "Rollback to stable",
      description:
        "Replace the candidate ReplicaSet with the last known-good release.",
      availableAfterMs: 10_000,
    },
    {
      id: "scale",
      label: "Scale the bad build",
      description: "Add replicas without removing the regressed code path.",
      availableAfterMs: 12_000,
    },
  ],
  events: [
    {
      id: "release",
      offsetMs: 0,
      phase: "Deploy",
      source: "gitops",
      title: "Candidate release synced",
      detail: "checkout candidate is rolling out behind Envoy.",
      severity: "info",
    },
    {
      id: "healthy-rollout",
      offsetMs: 5_000,
      phase: "Deploy",
      source: "kubernetes",
      title: "Rollout reports available",
      detail: "Readiness is green; synthetic traffic is beginning.",
      severity: "success",
    },
    {
      id: "regression",
      offsetMs: 10_000,
      phase: "Regression",
      source: "slo-controller",
      title: "Error budget burn accelerated",
      detail: "The candidate is slow and intermittently returns 5xx responses.",
      severity: "critical",
    },
    {
      id: "trace",
      offsetMs: 14_000,
      phase: "Trace",
      source: "opentelemetry",
      title: "pricing.apply dominates the trace",
      detail: "The regressed span is isolated from the healthy database query.",
      severity: "warning",
    },
    {
      id: "rollback-window",
      offsetMs: 28_000,
      phase: "Decision",
      source: "error-budget",
      title: "Rollback window is closing",
      detail:
        "Scaling can add capacity, but only rollback removes the faulty path.",
      severity: "critical",
    },
    {
      id: "verify",
      offsetMs: 52_000,
      phase: "Verify",
      source: "slo-controller",
      title: "Stable window evaluated",
      detail: "The run checks release state, p95 latency, and error rate.",
      severity: "success",
    },
    {
      id: "seal",
      offsetMs: 61_000,
      phase: "Evidence",
      source: "run-controller",
      title: "Regression report sealed",
      detail: "The suspect span and operator decisions are attached.",
      severity: "success",
    },
  ],
};

export const dataRecoveryScenario: LabScenario = {
  id: "catalogue-data-recovery",
  lab: "homelab",
  title: "Recover the data tier",
  eyebrow: "SRE drill 03",
  summary:
    "A disposable catalogue enters a degraded state. Restore service, then verify the recovery objective from live requests.",
  durationMs: 64_000,
  difficulty: "guided",
  resourceClass: "standard",
  telemetry: {
    ...commonTelemetry,
    incidentStartMs: 8_000,
    incidentEndMs: 52_000,
    pressureLatencyMs: 410,
    pressureErrorRatePct: 18,
  },
  decisions: [
    {
      id: "restore",
      label: "Restore clean dataset",
      description:
        "Roll the data tier forward from the scenario recovery point.",
      availableAfterMs: 8_000,
    },
    {
      id: "cache",
      label: "Serve cached catalogue",
      description: "Reduce customer impact while the data tier recovers.",
      availableAfterMs: 10_000,
    },
  ],
  events: [
    {
      id: "snapshot",
      offsetMs: 0,
      phase: "Provisioning",
      source: "longhorn",
      title: "Recovery point attached",
      detail:
        "A disposable catalogue and its clean recovery point are available.",
      severity: "info",
    },
    {
      id: "degraded",
      offsetMs: 8_000,
      phase: "Incident",
      source: "postgres",
      title: "Catalogue reads are degraded",
      detail: "Integrity checks and customer reads are failing.",
      severity: "critical",
    },
    {
      id: "rpo",
      offsetMs: 16_000,
      phase: "Diagnosis",
      source: "backup-controller",
      title: "Recovery point verified",
      detail: "The latest clean generation is inside the exercise RPO.",
      severity: "warning",
    },
    {
      id: "verify",
      offsetMs: 52_000,
      phase: "Verify",
      source: "synthetic-check",
      title: "Recovered data path evaluated",
      detail: "Live reads and the catalogue row count are being verified.",
      severity: "success",
    },
    {
      id: "seal",
      offsetMs: 61_000,
      phase: "Evidence",
      source: "run-controller",
      title: "Recovery evidence sealed",
      detail: "RPO, RTO, decisions, and request evidence were captured.",
      severity: "success",
    },
  ],
};

export const workerEvacuationScenario: LabScenario = {
  id: "worker-evacuation",
  lab: "homelab",
  title: "Evacuate a worker",
  eyebrow: "SRE drill 04",
  summary:
    "Move the disposable checkout replicas to the alternate worker pool and prove that the service stays available.",
  durationMs: 64_000,
  difficulty: "expert",
  resourceClass: "standard",
  telemetry: commonTelemetry,
  decisions: [
    {
      id: "evacuate",
      label: "Evacuate demo workload",
      description:
        "Reconcile checkout replicas onto the alternate worker pool.",
      availableAfterMs: 10_000,
    },
    {
      id: "scale",
      label: "Add a safety replica",
      description: "Raise capacity before moving the workload.",
      availableAfterMs: 8_000,
    },
  ],
  events: [
    {
      id: "placed",
      offsetMs: 0,
      phase: "Provisioning",
      source: "scheduler",
      title: "Workload placed on apps pool",
      detail: "The disposable workload is isolated from personal services.",
      severity: "success",
    },
    {
      id: "maintenance",
      offsetMs: 10_000,
      phase: "Maintenance",
      source: "node-controller",
      title: "Worker maintenance requested",
      detail:
        "Only scenario-owned checkout pods are eligible for this evacuation.",
      severity: "warning",
    },
    {
      id: "availability",
      offsetMs: 22_000,
      phase: "Evacuation",
      source: "envoy",
      title: "Availability window is active",
      detail: "Request success is measured while replacements become ready.",
      severity: "critical",
    },
    {
      id: "verify",
      offsetMs: 52_000,
      phase: "Verify",
      source: "scheduler",
      title: "Placement and SLO evaluated",
      detail: "The run checks the alternate pool and the request error budget.",
      severity: "success",
    },
    {
      id: "seal",
      offsetMs: 61_000,
      phase: "Evidence",
      source: "run-controller",
      title: "Evacuation report sealed",
      detail: "Placement changes and availability evidence were captured.",
      severity: "success",
    },
  ],
};

export const practiceClusterScenario: LabScenario = {
  id: "practice-cluster",
  lab: "homelab",
  title: "Practice cluster",
  eyebrow: "Open sandbox",
  summary:
    "A disposable Kubernetes workspace with a checkout API, Postgres, Redis, Envoy, and optional live traffic.",
  durationMs: 900_000,
  difficulty: "guided",
  resourceClass: "standard",
  telemetry: commonTelemetry,
  decisions: [],
  events: [],
};

export const homelabScenarios = [
  trafficSpikeScenario,
  badReleaseScenario,
  dataRecoveryScenario,
  workerEvacuationScenario,
  practiceClusterScenario,
] as const;

export function getHomelabScenario(id: string): LabScenario {
  return (
    homelabScenarios.find((scenario) => scenario.id === id) ??
    trafficSpikeScenario
  );
}

// The drill catalog the site renders comes from the API (/api/live/drills), which is the only place
// that knows the full list and what the field has scored on it. The scenarios above are the fixture
// set for the standalone demo engine behind /api/v1/*, and are deliberately not that catalog.
