import type { LiveRunView } from "@/shared/api/live-client";

// What a decision actually did to the cluster, and what happened to the measured signals after it.
//
// Every option is really applied, so the honest way to show consequence is to diff the run before
// and after the click and then keep watching. Nothing here is animated or invented: the tier deltas
// are the spec the operator changed, and the telemetry deltas are what the platform measured in the
// seconds that followed.

/** One tier a decision moved, in the vocabulary the graph draws. */
export interface TierImpact {
  /** Deployment name, so the graph can find the cards to mark. */
  tier: string;
  label: string;
  from: string;
  to: string;
  /** Whether this change made the tier smaller/worse — what gets drawn in red. */
  degrading: boolean;
}

/** The measured state at the instant a decision was taken, to compare against later. */
export interface TelemetryMark {
  p95LatencyMs: number;
  errorRatePct: number;
  requestsPerSec: number;
  offeredRequestsPerSec: number;
}

export interface DecisionRecord {
  optionId: string;
  label: string;
  correct: boolean;
  at: number;
  impact: TierImpact[];
  before: TelemetryMark;
}

export function mark(run: LiveRunView): TelemetryMark {
  return {
    p95LatencyMs: run.telemetry.p95LatencyMs,
    errorRatePct: run.telemetry.errorRatePct,
    requestsPerSec: run.telemetry.requestsPerSec,
    offeredRequestsPerSec: run.offeredRequestsPerSec,
  };
}

// The tiers a spec field belongs to, so a change can be pointed at the cards it moved.
const CHECKOUT = "checkout";
const CANARY = "checkout-canary";
const GATEWAY = "envoy";
const CACHE = "redis";
const LOAD = "k6";
const DATA = "postgres";

/** Diff two runs into the tier changes a decision caused. */
export function impactOf(before: LiveRunView, after: LiveRunView): TierImpact[] {
  const out: TierImpact[] = [];

  const num = (
    tier: string,
    label: string,
    a: number,
    b: number,
    lowerIsWorse = true,
  ) => {
    if (a === b) return;
    out.push({
      tier,
      label,
      from: String(a),
      to: String(b),
      degrading: lowerIsWorse ? b < a : b > a,
    });
  };

  num(
    CHECKOUT,
    "Checkout replicas",
    before.telemetry.apiReplicas,
    after.telemetry.apiReplicas,
  );
  num(CANARY, "Canary replicas", before.canaryReplicas, after.canaryReplicas, false);
  num(GATEWAY, "Gateway replicas", before.gatewayReplicas, after.gatewayReplicas);
  num(LOAD, "Offered load", before.loadGenerators, after.loadGenerators, false);

  if (before.telemetry.cacheActive !== after.telemetry.cacheActive)
    out.push({
      tier: CACHE,
      label: "Cache tier",
      from: before.telemetry.cacheActive ? "on" : "off",
      to: after.telemetry.cacheActive ? "on" : "off",
      degrading: !after.telemetry.cacheActive,
    });

  if (before.releaseTrack !== after.releaseTrack)
    out.push({
      tier: CHECKOUT,
      label: "Release",
      from: before.releaseTrack,
      to: after.releaseTrack,
      degrading: after.releaseTrack === "candidate",
    });

  if (before.dataState !== after.dataState)
    out.push({
      tier: DATA,
      label: "Catalogue",
      from: before.dataState,
      to: after.dataState,
      degrading: after.dataState === "degraded",
    });

  if (before.targetPool !== after.targetPool)
    out.push({
      tier: CHECKOUT,
      label: "Worker pool",
      from: before.targetPool,
      to: after.targetPool,
      degrading: false,
    });

  return out;
}

/** One measured signal, then and now. */
export interface Consequence {
  label: string;
  before: string;
  now: string;
  worse: boolean;
}

const ms = (v: number) =>
  v < 10 ? `${Math.round(v * 10) / 10} ms` : `${Math.round(v)} ms`;

/**
 * What the platform measured in the seconds after a decision. A wrong move's damage is real and
 * takes a moment to show up in a windowed scrape, so this is what turns "that was wrong" into
 * "and here is what it did".
 */
export function consequencesOf(
  before: TelemetryMark,
  run: LiveRunView,
): Consequence[] {
  const now = mark(run);
  const out: Consequence[] = [
    {
      label: "p95 latency",
      before: ms(before.p95LatencyMs),
      now: ms(now.p95LatencyMs),
      worse: now.p95LatencyMs > before.p95LatencyMs * 1.15,
    },
    {
      label: "Error rate",
      before: `${before.errorRatePct.toFixed(2)}%`,
      now: `${now.errorRatePct.toFixed(2)}%`,
      worse: now.errorRatePct > before.errorRatePct + 0.2,
    },
  ];

  if (now.offeredRequestsPerSec > 0 || before.offeredRequestsPerSec > 0)
    out.push({
      label: "Served load",
      before: `${before.requestsPerSec}/s`,
      now: `${now.requestsPerSec}/s`,
      worse: now.requestsPerSec < before.requestsPerSec * 0.85,
    });

  return out;
}
