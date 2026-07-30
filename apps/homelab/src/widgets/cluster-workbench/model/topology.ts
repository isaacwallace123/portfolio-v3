import { Database, Radio, Server, Zap } from "lucide-react";

// The request path, laid out in columns. Every POD renders as its own card, so a checkout scaled to
// six shows six cards the gateway is balancing across — the graph grows with the workload instead of
// a replica counter changing.
// Keys are Deployment names: the graph looks each tier up in the components the API measured, so a
// service id that does not match its Deployment renders as a permanently empty card.
export const SERVICES = {
  k6: { label: "k6", role: "load generator", icon: Zap },
  envoy: { label: "Envoy", role: "gateway", icon: Radio },
  checkout: { label: "checkout", role: "API", icon: Server },
  "checkout-canary": { label: "canary", role: "candidate build", icon: Server },
  postgres: { label: "Postgres", role: "database", icon: Database },
  redis: { label: "Redis", role: "cache", icon: Database },
} as const;

export type ServiceId = keyof typeof SERVICES;

export const COLUMNS: ServiceId[][] = [
  ["k6"],
  ["envoy"],
  // The canary shares the gateway's backend pool, so it belongs beside checkout rather than after
  // it — the split is the replica ratio, not a separate hop.
  ["checkout", "checkout-canary"],
  ["postgres", "redis"],
];

// Traffic flows column to column; edges are drawn card-to-card, so they fan out across replicas.
export const FLOWS: [ServiceId, ServiceId][] = [
  ["k6", "envoy"],
  ["envoy", "checkout"],
  ["envoy", "checkout-canary"],
  ["checkout", "postgres"],
  ["checkout", "redis"],
  ["checkout-canary", "postgres"],
  ["checkout-canary", "redis"],
];

/** The tiers whose replica count the operator can change, and which therefore converge visibly. */
export const SCALABLE: ServiceId[] = [
  "checkout",
  "checkout-canary",
  "k6",
  "redis",
  "envoy",
];

/**
 * The tiers the Worker pool control actually schedules — the only ones whose placement is a fact
 * about an operator decision.
 *
 * Nothing else in the run carries a nodeSelector, so the gateway, the generators, Postgres and Redis
 * land wherever the scheduler puts them: a three-replica gateway routinely comes up with one pod on
 * infra and two on apps. Labelling those pods with a pool read as a category the operator had chosen
 * and could change, when there is no control that moves them and the migration drills say outright
 * that the gateway does not move between pools. Where an unpinned tier happens to land is the
 * scheduler's business, so the graph no longer reports it as a category.
 */
export const POOLED: readonly ServiceId[] = ["checkout", "checkout-canary"];
