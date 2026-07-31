import { describe, expect, it } from "vitest";
import type { LiveRunView, RunComponent } from "@/shared/api/live-client";
import {
  buildDebrief,
  coachingPhase,
  decisionsUnlocked,
  evidenceFor,
  evidenceRemaining,
  evidenceSatisfied,
  hypothesesFor,
  tierUtilisation,
  type CoachingInputs,
} from "./coaching";
import type { DecisionRecord } from "./impact";

// The practice drill's teaching flow, tested without a cluster. That is the whole reason it was
// written as pure functions over a run: the rules about when controls unlock, and what a debrief
// says, are the parts worth being sure about.

function run(over: Partial<LiveRunView> = {}): LiveRunView {
  return {
    runId: "run-hl-abc123",
    scenarioId: "checkout-traffic-spike",
    status: "running",
    queuePosition: 0,
    createdAt: "2026-07-30T00:00:00Z",
    elapsedMs: 62_000,
    durationMs: 90_000,
    ttlMs: 900_000,
    remainingTtlMs: 800_000,
    telemetry: {
      requestsPerSec: 610,
      p95LatencyMs: 930,
      latencyTargetMs: 250,
      errorRatePct: 0.4,
      apiReplicas: 1,
      postgresCpuPct: 12,
      cacheActive: false,
      score: 45,
    },
    visibleEvents: [],
    acceptedDecisions: [],
    availableDecisions: [],
    complete: false,
    reportReady: false,
    live: true,
    renewable: true,
    deleting: false,
    namespace: "lab-abc123",
    podCount: 6,
    cpuMillicores: 900,
    memoryMiB: 512,
    measuredTelemetry: {
      requestsPerSec: 610,
      p95LatencyMs: 930,
      errorRatePct: 0.4,
    },
    releaseTrack: "stable",
    dataState: "healthy",
    targetPool: "apps",
    loadEnabled: true,
    loadGenerators: 2,
    gatewayReplicas: 1,
    canaryReplicas: 0,
    offeredRequestsPerSec: 800,
    restartToken: "baseline",
    rankedActions: [],
    drillId: "checkout-traffic-spike",
    drillTitle: "Keep checkout alive",
    drillObjective: "Serve the offered load.",
    drillMode: "practice",
    drillStage: 1,
    drillStageCount: 1,
    drillStageTitle: "Absorb the surge",
    drillStageObjective: "Serve the offered load.",
    drillStageHandoff: "",
    drillStageElapsedSeconds: 40,
    drillParSeconds: 90,
    drillComplete: false,
    drillSolved: false,
    drillFailed: false,
    drillFailedMove: "",
    drillCorrectChosen: 0,
    drillCorrectTotal: 1,
    drillCorrectChosenAll: 0,
    drillCorrectTotalAll: 1,
    drillWrongChosen: 0,
    drillOptions: [],
    drillGoals: [],
    drillHeldSeconds: 0,
    drillHoldSeconds: 20,
    rankedBriefing: null,
    rankedDebrief: null,
    ...over,
  };
}

function component(over: Partial<RunComponent> = {}): RunComponent {
  return {
    name: "checkout",
    desired: 1,
    ready: 1,
    cpuMillicores: 480,
    memoryMiB: 220,
    cpuLimitMillicoresPerPod: 500,
    pods: [
      {
        name: "checkout-1",
        phase: "Running",
        ready: true,
        restarts: 0,
        cpuMillicores: 480,
        memoryMiB: 220,
        detail: "",
        pool: "apps",
      },
    ],
    ...over,
  };
}

function inputs(over: Partial<CoachingInputs> = {}): CoachingInputs {
  return {
    run: run(),
    drillPhase: "running",
    inspected: new Set(),
    evidenceCount: 9,
    evidenceDone: false,
    hypothesis: null,
    briefingRead: false,
    unreadConsequence: false,
    ...over,
  };
}

/** Enough evidence read, and the learner has said they are done reading it. */
const observed = {
  inspected: new Set(["a", "b", "c", "d", "e", "f"]),
  evidenceDone: true,
};

describe("tier utilisation", () => {
  it("is CPU as a share of the pod's own limit", () => {
    expect(tierUtilisation(component())).toBeCloseTo(96);
  });

  it("is null with no ready pods, rather than zero", () => {
    // Zero would read as "idle", which is the opposite of what "nothing is running" means.
    const scaling = component({
      pods: [{ ...component().pods[0], ready: false }],
    });
    expect(tierUtilisation(scaling)).toBeNull();
  });

  it("is null when the limit is unknown", () => {
    expect(
      tierUtilisation(component({ cpuLimitMillicoresPerPod: 0 })),
    ).toBeNull();
  });

  it("is null for a tier that does not exist", () => {
    expect(tierUtilisation(undefined)).toBeNull();
  });

  it("averages over the ready pods only", () => {
    const half = component({
      cpuLimitMillicoresPerPod: 500,
      pods: [
        { ...component().pods[0], cpuMillicores: 250 },
        { ...component().pods[0], name: "b", ready: false, cpuMillicores: 0 },
      ],
    });
    expect(tierUtilisation(half)).toBeCloseTo(50);
  });
});

describe("evidence", () => {
  it("reads the cluster's own measurements", () => {
    const items = evidenceFor(run(), [component()]);
    const throughput = items.find((i) => i.id === "throughput")!;
    expect(throughput.value).toBe("800/s offered · 610/s served");

    const cpu = items.find((i) => i.id === "checkout-cpu")!;
    expect(cpu.value).toContain("96% of limit");
  });

  it("offers the same core signals for every incident", () => {
    // A curated three-item list per drill teaches which list goes with which drill. The whole
    // instrument panel, every time, teaches reading the instrument panel.
    const core = [
      "throughput",
      "latency",
      "errors",
      "checkout-cpu",
      "gateway-cpu",
    ];
    const spike = evidenceFor(run(), [component()]).map((i) => i.id);
    const canary = evidenceFor(
      run({ drillId: "canary-catch", canaryReplicas: 2 }),
      [component()],
    ).map((i) => i.id);
    for (const id of core) {
      expect(spike).toContain(id);
      expect(canary).toContain(id);
    }
  });

  it("adds a canary row only when there is a canary to read", () => {
    expect(evidenceFor(run(), [component()]).map((i) => i.id)).not.toContain(
      "canary",
    );
    expect(
      evidenceFor(run({ canaryReplicas: 2 }), [component()]).map((i) => i.id),
    ).toContain("canary");
  });

  it("adds a placement row once pods have actually landed", () => {
    const unscheduled = component({
      pods: [{ ...component().pods[0], pool: "" }],
    });
    expect(evidenceFor(run(), [unscheduled]).map((i) => i.id)).not.toContain(
      "placement",
    );
    expect(evidenceFor(run(), [component()]).map((i) => i.id)).toContain(
      "placement",
    );
  });

  it("says 'no ready pods' rather than 0% for a tier that is still starting", () => {
    const items = evidenceFor(run(), []);
    expect(items.find((i) => i.id === "checkout-cpu")!.value).toBe(
      "no ready pods",
    );
  });

  it("gives every item the question it answers", () => {
    for (const item of evidenceFor(run({ canaryReplicas: 1 }), [component()]))
      expect(item.question.length, item.id).toBeGreaterThan(30);
  });
});

describe("the evidence gate", () => {
  it("needs two thirds of the signals, not all of them", () => {
    expect(evidenceSatisfied(5, 9)).toBe(false);
    expect(evidenceSatisfied(6, 9)).toBe(true);
    expect(evidenceRemaining(2, 9)).toBe(4);
  });

  it("is satisfied when there is nothing to read", () => {
    expect(evidenceSatisfied(0, 0)).toBe(true);
    expect(evidenceRemaining(0, 0)).toBe(0);
  });

  it("never reports negative remaining", () => {
    expect(evidenceRemaining(20, 9)).toBe(0);
  });
});

describe("the coaching phase machine", () => {
  it("starts at the briefing", () => {
    expect(coachingPhase(inputs())).toBe("briefing");
  });

  it("gates the controls on evidence rather than on a clock", () => {
    const read = inputs({ briefingRead: true });
    expect(coachingPhase(read)).toBe("observe");
    expect(decisionsUnlocked("observe")).toBe(false);

    // An hour of elapsed drill time changes nothing. This is the behaviour that replaced
    // "decisions unlock in 10 seconds".
    const waited = inputs({
      briefingRead: true,
      run: run({ drillStageElapsedSeconds: 3600 }),
    });
    expect(coachingPhase(waited)).toBe("observe");
  });

  it("stays on the evidence until the learner says they are done reading", () => {
    // Reaching the threshold must not yank the screen away mid-read. Reading the rest of the panel
    // is behaviour to encourage, so the threshold decides when they MAY move on and the button
    // decides when they do.
    const enough = inputs({
      briefingRead: true,
      inspected: observed.inspected,
    });
    expect(coachingPhase(enough)).toBe("observe");
    expect(coachingPhase({ ...enough, evidenceDone: true })).toBe(
      "hypothesise",
    );
  });

  it("will not let a learner skip the reading by declaring themselves done", () => {
    const skipped = inputs({
      briefingRead: true,
      inspected: new Set(["a"]),
      evidenceDone: true,
    });
    expect(coachingPhase(skipped)).toBe("observe");
  });

  it("asks for a hypothesis once the evidence is read", () => {
    expect(coachingPhase(inputs({ briefingRead: true, ...observed }))).toBe(
      "hypothesise",
    );
  });

  it("unlocks the controls once a fault has been named", () => {
    const ready = inputs({
      briefingRead: true,
      ...observed,
      hypothesis: "checkout",
    });
    expect(coachingPhase(ready)).toBe("act");
    expect(decisionsUnlocked("act")).toBe(true);
  });

  it("keeps the controls locked in every phase before acting", () => {
    // The gate is evidence, and `consequence` is excluded because that screen owns the panel —
    // the operator console is not on it. `useCoaching` calls this rather than restating it.
    expect(decisionsUnlocked("briefing")).toBe(false);
    expect(decisionsUnlocked("observe")).toBe(false);
    expect(decisionsUnlocked("hypothesise")).toBe(false);
    expect(decisionsUnlocked("consequence")).toBe(false);
    expect(decisionsUnlocked("debrief")).toBe(false);
    expect(decisionsUnlocked("verify")).toBe(true);
  });

  it("shows the consequence of a wrong action instead of ending the drill", () => {
    const misstep = inputs({
      briefingRead: true,
      ...observed,
      hypothesis: "checkout",
      drillPhase: "misstep",
    });
    // Practice continues: this is a screen to read, not a failure state.
    expect(coachingPhase(misstep)).toBe("consequence");
    expect(coachingPhase({ ...misstep, drillPhase: "running" })).toBe("act");
  });

  it("shows the consequence of a correct action too", () => {
    const landed = inputs({
      briefingRead: true,
      ...observed,
      hypothesis: "checkout",
      unreadConsequence: true,
    });
    expect(coachingPhase(landed)).toBe("consequence");
  });

  it("explains the hold window while the objective is being confirmed", () => {
    const holding = inputs({
      briefingRead: true,
      ...observed,
      hypothesis: "checkout",
      drillPhase: "holding",
    });
    expect(coachingPhase(holding)).toBe("verify");
  });

  it("goes to the debrief when the broker says it is solved, from any phase", () => {
    // The broker is the authority. A solve reached while the learner was still reading evidence
    // still ends in a debrief rather than stranding them mid-flow.
    expect(coachingPhase(inputs({ run: run({ drillSolved: true }) }))).toBe(
      "debrief",
    );
    expect(coachingPhase(inputs({ drillPhase: "solved" }))).toBe("debrief");
  });
});

describe("hypotheses", () => {
  it("offers one candidate per place a fault can live", () => {
    const options = hypothesesFor(run());
    expect(options.map((o) => o.id)).toEqual([
      "checkout",
      "envoy",
      "release",
      "data",
    ]);
  });

  it("adds the canary when there is one", () => {
    expect(
      hypothesesFor(run({ canaryReplicas: 2 })).map((o) => o.id),
    ).toContain("canary");
  });

  it("says what should change if each one is right", () => {
    for (const option of hypothesesFor(run({ canaryReplicas: 1 })))
      expect(option.predicts.length, option.id).toBeGreaterThan(30);
  });
});

describe("the debrief", () => {
  const record = (
    label: string,
    correct: boolean,
    at: number,
  ): DecisionRecord => ({
    optionId: label,
    label,
    correct,
    at,
    impact: [
      {
        tier: "checkout",
        label: "Checkout replicas",
        from: "1",
        to: "4",
        degrading: false,
      },
    ],
    before: {
      p95LatencyMs: 930,
      errorRatePct: 0.4,
      requestsPerSec: 610,
      offeredRequestsPerSec: 800,
    },
  });

  const opening = { offered: 800, served: 610, p95: 930, errors: 0.4 };
  const solved = run({
    drillSolved: true,
    telemetry: { ...run().telemetry, requestsPerSec: 790, p95LatencyMs: 164 },
  });

  it("reads the timeline forwards, hypothesis first", () => {
    // History is newest-first everywhere else. A debrief is a story, so it reads in the order the
    // learner actually did things.
    const debrief = buildDebrief(
      solved,
      {
        hypothesisId: "checkout",
        hypothesisLabel: null,
        inspected: [],
        opening,
      },
      [record("second", true, 2), record("first", false, 1)],
      hypothesesFor(solved),
    );

    expect(debrief.timeline[0].kind).toBe("hypothesis");
    expect(debrief.timeline[1].label).toBe("first");
    expect(debrief.timeline[2].label).toBe("second");
  });

  it("is clean only when nothing wrong was applied", () => {
    const base = {
      hypothesisId: "checkout",
      hypothesisLabel: null,
      inspected: [],
      opening,
    };
    expect(
      buildDebrief(solved, base, [record("a", true, 1)], hypothesesFor(solved))
        .clean,
    ).toBe(true);
    expect(
      buildDebrief(solved, base, [record("a", false, 1)], hypothesesFor(solved))
        .clean,
    ).toBe(false);
  });

  it("states the causal chain in the platform's own numbers", () => {
    const debrief = buildDebrief(
      solved,
      {
        hypothesisId: "checkout",
        hypothesisLabel: null,
        inspected: [],
        opening,
      },
      [record("Scale checkout to four replicas", true, 1)],
      hypothesesFor(solved),
    );

    expect(debrief.causalChain).toContain("610/s to 790/s");
    expect(debrief.causalChain).toContain("930 ms to 164 ms");
    expect(debrief.causalChain).toContain("addressed the cause");
    expect(debrief.causalChain).not.toMatch(/^(Correct|Incorrect)/);
  });

  it("names the actions that did not address the cause", () => {
    const debrief = buildDebrief(
      solved,
      { hypothesisId: "envoy", hypothesisLabel: null, inspected: [], opening },
      [
        record("Scale the gateway", false, 1),
        record("Scale checkout", true, 2),
      ],
      hypothesesFor(solved),
    );
    expect(debrief.unnecessary).toEqual(["Scale the gateway"]);
    expect(debrief.causalChain).toContain("without addressing the cause");
  });

  it("teaches re-diagnosis after a wrong action, and the reading order after a clean one", () => {
    const base = {
      hypothesisId: "checkout",
      hypothesisLabel: null,
      inspected: ["a", "b", "c", "d", "e", "f"],
      opening,
    };
    expect(
      buildDebrief(solved, base, [record("a", false, 1)], hypothesesFor(solved))
        .keyLesson,
    ).toContain("different system");
    expect(
      buildDebrief(solved, base, [record("a", true, 1)], hypothesesFor(solved))
        .keyLesson,
    ).toContain("instrument panel");
  });

  it("carries both the diagnosis-time and current measurements", () => {
    const debrief = buildDebrief(
      solved,
      { hypothesisId: null, hypothesisLabel: null, inspected: [], opening },
      [],
      hypothesesFor(solved),
    );
    expect(debrief.before).toEqual(opening);
    expect(debrief.after.served).toBe(790);
    expect(debrief.elapsedMs).toBe(62_000);
  });

  it("survives a learner who never chose a hypothesis", () => {
    const debrief = buildDebrief(
      solved,
      { hypothesisId: null, hypothesisLabel: null, inspected: [], opening },
      [],
      hypothesesFor(solved),
    );
    expect(debrief.timeline).toEqual([]);
    expect(debrief.keyLesson.length).toBeGreaterThan(20);
  });
});
