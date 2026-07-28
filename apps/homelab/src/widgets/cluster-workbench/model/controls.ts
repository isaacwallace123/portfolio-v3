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
    label: "Load intensity",
    hint: "Each generator runs the same closed-loop script — more generators mean more concurrent users.",
    min: 0,
    max: 4,
    prefix: "load-",
    value: (r: LiveRunView) => r.loadGenerators,
    apply: (r: LiveRunView, n: number) => ({
      ...r,
      loadGenerators: n,
      loadEnabled: n > 0,
    }),
    unit: (n: number) => (n === 0 ? "no traffic" : `${n}× generator`),
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
