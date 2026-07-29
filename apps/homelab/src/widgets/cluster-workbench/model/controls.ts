import type { LiveRunView } from "@/shared/api/live-client";

// Every control mirrors the broker's effect locally through `apply`, so the UI reflects the new
// state the instant it is used rather than waiting a poll for the round trip.

const withReplicas = (r: LiveRunView, n: number): LiveRunView => ({
  ...r,
  telemetry: { ...r.telemetry, apiReplicas: n },
});

const withCache = (r: LiveRunView, on: boolean): LiveRunView => ({
  ...r,
  telemetry: { ...r.telemetry, cacheActive: on },
});

// Continuous dials. The action id carries the exact value ("scale-4"); the API bounds it to the same
// range the XRD enforces, so a slider can never ask for something the platform would not allow.
export const SLIDERS = [
  {
    label: "Checkout replicas",
    hint: "Each replica has its own CPU limit, so capacity scales with this and p95 falls under load.",
    min: 1,
    max: 6,
    prefix: "scale-",
    value: (r: LiveRunView) => r.telemetry.apiReplicas,
    apply: (r: LiveRunView, n: number) => withReplicas(r, n),
    unit: (n: number) => `${n} replica${n === 1 ? "" : "s"}`,
  },
  {
    // The canary runs the candidate build beside the stable fleet and shares the gateway's backend
    // pool, so its share of traffic is simply its share of the replicas.
    label: "Canary replicas",
    hint: "Replicas running the candidate build alongside the stable ones. Their share of the replicas is their share of the traffic.",
    min: 0,
    max: 3,
    prefix: "canary-",
    value: (r: LiveRunView) => r.canaryReplicas,
    apply: (r: LiveRunView, n: number) => ({ ...r, canaryReplicas: n }),
    unit: (n: number) => (n === 0 ? "no canary" : `${n} on candidate`),
  },
  {
    label: "Gateway replicas",
    hint: "Envoy is CPU-limited like every other tier. Past roughly 2000 rps the front door, not the app behind it, is where requests queue.",
    min: 1,
    max: 3,
    prefix: "gateway-",
    value: (r: LiveRunView) => r.gatewayReplicas,
    apply: (r: LiveRunView, n: number) => ({ ...r, gatewayReplicas: n }),
    unit: (n: number) => `${n} gateway${n === 1 ? "" : "s"}`,
  },
  {
    // Offered load, not achieved load: the generators run an open-loop script at a fixed arrival
    // rate, so this dial is how much traffic ARRIVES. Whether it gets served is the exercise.
    label: "Offered load",
    hint: "Each generator offers a fixed 500 requests a second whether or not the stack can serve them. The shortfall is what a capacity drill is scored on.",
    min: 0,
    max: 4,
    prefix: "load-",
    value: (r: LiveRunView) => r.loadGenerators,
    apply: (r: LiveRunView, n: number) => ({
      ...r,
      loadGenerators: n,
      loadEnabled: n > 0,
      offeredRequestsPerSec: n * 500,
    }),
    unit: (n: number) => (n === 0 ? "no traffic" : `${n * 500}/s offered`),
  },
] as const;

// Genuinely categorical choices, which is why these stay segmented rather than becoming dials.
export const CONTROLS = [
  {
    label: "Cache tier",
    hint: "Redis in front of Postgres. A cache hit skips the request's work entirely.",
    active: (r: LiveRunView) =>
      r.telemetry.cacheActive ? "cache-on" : "cache-off",
    options: [
      {
        id: "cache-off",
        label: "Off",
        apply: (r: LiveRunView) => withCache(r, false),
      },
      {
        id: "cache-on",
        label: "On",
        apply: (r: LiveRunView) => withCache(r, true),
      },
    ],
  },
  {
    label: "Release track",
    hint: "The candidate build carries a real slow, occasionally failing pricing path.",
    active: (r: LiveRunView) => `release-${r.releaseTrack}`,
    options: [
      {
        id: "release-stable",
        label: "Stable",
        apply: (r: LiveRunView) => ({ ...r, releaseTrack: "stable" as const }),
      },
      {
        id: "release-candidate",
        label: "Candidate",
        apply: (r: LiveRunView) => ({
          ...r,
          releaseTrack: "candidate" as const,
        }),
      },
    ],
  },
  {
    label: "Worker pool",
    hint: "Which node pool the checkout replicas are scheduled onto.",
    active: (r: LiveRunView) => `move-${r.targetPool}`,
    options: [
      {
        id: "move-apps",
        label: "Apps",
        apply: (r: LiveRunView) => ({ ...r, targetPool: "apps" as const }),
      },
      {
        id: "move-infra",
        label: "Infra",
        apply: (r: LiveRunView) => ({ ...r, targetPool: "infra" as const }),
      },
    ],
  },
] as const;
