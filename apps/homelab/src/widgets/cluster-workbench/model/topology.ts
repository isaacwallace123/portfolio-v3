import { Database, Radio, Server, Zap } from "lucide-react";

// The request path, laid out in columns. Every POD renders as its own card, so a checkout scaled to
// six shows six cards the gateway is balancing across — the graph grows with the workload instead of
// a replica counter changing.
export const SERVICES = {
  k6: { label: "k6", role: "load generator", icon: Zap },
  envoy: { label: "Envoy", role: "gateway", icon: Radio },
  checkout: { label: "checkout", role: "API", icon: Server },
  postgres: { label: "Postgres", role: "database", icon: Database },
  redis: { label: "Redis", role: "cache", icon: Database },
} as const;

export type ServiceId = keyof typeof SERVICES;

export const COLUMNS: ServiceId[][] = [
  ["k6"],
  ["envoy"],
  ["checkout"],
  ["postgres", "redis"],
];

// Traffic flows column to column; edges are drawn card-to-card, so they fan out across replicas.
export const FLOWS: [ServiceId, ServiceId][] = [
  ["k6", "envoy"],
  ["envoy", "checkout"],
  ["checkout", "postgres"],
  ["checkout", "redis"],
];

/** The tiers whose replica count the operator can change, and which therefore converge visibly. */
export const SCALABLE: ServiceId[] = ["checkout", "k6", "redis"];
