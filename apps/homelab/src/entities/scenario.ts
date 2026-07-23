import type { LabScenario } from "@iw/lab-runtime";

export const trafficSpikeScenario: LabScenario = {
  id: "checkout-traffic-spike",
  lab: "homelab",
  title: "Keep checkout alive",
  eyebrow: "SRE drill 01",
  summary:
    "A real three-tier workload takes a sudden traffic surge. Read the signals, make an intervention, and preserve the SLO.",
  durationMs: 48_000,
  difficulty: "operator",
  resourceClass: "standard",
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
    {
      id: "rollback",
      label: "Rollback release",
      description: "Return to the last known-good application image.",
      availableAfterMs: 20_000,
    },
  ],
  events: [
    {
      id: "accepted",
      offsetMs: 0,
      phase: "Provisioning",
      source: "run-controller",
      title: "Run admitted",
      detail: "Reserved 4 vCPU and 6 GiB for namespace run-hl-2407.",
      severity: "info",
    },
    {
      id: "gitops",
      offsetMs: 3_000,
      phase: "Provisioning",
      source: "argocd",
      title: "Desired state synced",
      detail:
        "Checkout, catalogue, Redis, Postgres, and telemetry are healthy.",
      severity: "success",
    },
    {
      id: "warm",
      offsetMs: 8_000,
      phase: "Baseline",
      source: "load-generator",
      title: "Baseline established",
      detail: "118 req/s at 43 ms p95 with zero failed requests.",
      severity: "success",
    },
    {
      id: "surge",
      offsetMs: 15_000,
      phase: "Incident",
      source: "k6",
      title: "Traffic multiplied 8×",
      detail: "The workload is receiving 940 requests per second.",
      severity: "warning",
    },
    {
      id: "saturation",
      offsetMs: 21_000,
      phase: "Incident",
      source: "prometheus",
      title: "Checkout SLO is burning",
      detail: "API CPU crossed 90%; p95 latency is above 600 ms.",
      severity: "critical",
    },
    {
      id: "hpa",
      offsetMs: 31_000,
      phase: "Recovery",
      source: "kubernetes",
      title: "Capacity reconciled",
      detail: "New API replicas passed readiness and entered service.",
      severity: "info",
    },
    {
      id: "recovered",
      offsetMs: 39_000,
      phase: "Recovery",
      source: "slo-controller",
      title: "Latency returned to budget",
      detail: "p95 has remained below 120 ms for the recovery window.",
      severity: "success",
    },
    {
      id: "evidence",
      offsetMs: 46_000,
      phase: "Evidence",
      source: "run-controller",
      title: "Evidence bundle sealed",
      detail:
        "Metrics, traces, decisions, and Kubernetes events were collected.",
      severity: "success",
    },
  ],
};

export const upcomingDrills = [
  {
    title: "Ship a bad release",
    tag: "GitOps · canary",
    description:
      "Trace a regression through spans and roll back before the error budget is gone.",
  },
  {
    title: "Recover the data tier",
    tag: "Longhorn · Postgres",
    description:
      "Restore a disposable dataset and prove recovery point and recovery time objectives.",
  },
  {
    title: "Evacuate a worker",
    tag: "Kubernetes · scheduling",
    description:
      "Drain a dedicated demo worker while maintaining availability and storage safety.",
  },
];
