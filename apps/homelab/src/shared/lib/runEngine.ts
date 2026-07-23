import { createRunEngine, type RunEngine } from "@iw/lab-runtime";
import { trafficSpikeScenario } from "@/entities/scenario";

// Process-wide run engine singleton backing the /api/v1 routes. In-memory today; the production
// build swaps createRunEngine() for the Crossplane-claim engine without touching the routes.
//
// A globalThis handle keeps a single instance across dev HMR reloads and across route modules that
// each import this file — otherwise every route would get its own runs Map and lose lifecycle state.
const KEY = Symbol.for("homeops.runEngine");

type GlobalWithEngine = typeof globalThis & { [KEY]?: RunEngine };

function build(): RunEngine {
  return createRunEngine({
    scenarios: [trafficSpikeScenario],
    maxConcurrentRuns: 1,
    runTtlMs: 15 * 60_000,
    vcpu: 4,
    memoryGiB: 6,
  });
}

export function getRunEngine(): RunEngine {
  const g = globalThis as GlobalWithEngine;
  if (!g[KEY]) g[KEY] = build();
  return g[KEY]!;
}
