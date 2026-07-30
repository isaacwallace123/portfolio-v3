import type { LiveRunView, RunComponent } from "@/shared/api/live-client";
import type { DecisionRecord } from "./impact";

// The practice drill's teaching flow.
//
//   briefing → observe → hypothesise → act → consequence → verify → debrief
//
// Practice only. Ranked never constructs any of this: a competitive attempt is a one-shot incident
// where being made to tick boxes before acting would be an obstacle rather than a lesson, and the
// rules are deliberately different. Nothing here writes ranked data and nothing here is imported by
// the ranked slice.
//
// Everything in this file is a pure function of the live run. The evidence a learner inspects is
// read from the same measured telemetry the graph is drawn from — there are no invented numbers
// here, because "make the learner look at the evidence" is worthless if the evidence is decorative.

export type CoachingPhase =
  /** Read the incident. No controls yet. */
  | "briefing"
  /** Inspect the evidence. Decisions are locked until enough of it has been looked at. */
  | "observe"
  /** Name the fault and say what would prove it. Never scored, never fatal. */
  | "hypothesise"
  /** Operate the cluster. */
  | "act"
  /** A decision has landed and its measured effect is being read. */
  | "consequence"
  /** Every condition met; the platform is confirming it holds. */
  | "verify"
  /** Resolved. The evidence-backed result screen. */
  | "debrief";

/** How much of the evidence must be inspected before the controls unlock.
 *
 *  A fraction rather than "all of it": some evidence is only relevant to hypotheses the learner has
 *  already ruled out, and forcing a click on every card teaches clicking. Two thirds is enough that
 *  nobody reaches the controls without having read the signals that matter. */
export const EVIDENCE_FRACTION = 2 / 3;

/** One thing the learner can look at, with the cluster's actual value for it. */
export interface EvidenceItem {
  id: string;
  label: string;
  /** The measured value, formatted. Always real — this is the run's own telemetry. */
  value: string;
  /** What this signal would tell you, phrased as the question it answers. */
  question: string;
  /** The tier it describes, so inspecting it can highlight the graph. */
  tier: string | null;
}

/** A candidate fault, offered as a selection rather than free text. */
export interface HypothesisOption {
  id: string;
  label: string;
  /** The tier this blames. */
  tier: string;
  /** What the learner should expect to change if they are right. */
  predicts: string;
}

const pct = (v: number) => `${Math.round(v)}%`;
const ms = (v: number) =>
  v < 10 ? `${Math.round(v * 10) / 10} ms` : `${Math.round(v)} ms`;

/** Per-pod CPU as a share of the pod's limit, averaged over the ready pods. The single most
 *  diagnostic number in the whole arena, and the one a learner has to be taught to reach for. */
export function tierUtilisation(
  component: RunComponent | undefined,
): number | null {
  if (!component) return null;
  const ready = component.pods.filter((p) => p.ready);
  if (ready.length === 0 || component.cpuLimitMillicoresPerPod <= 0)
    return null;
  const used =
    ready.reduce((sum, p) => sum + p.cpuMillicores, 0) / ready.length;
  return (used / component.cpuLimitMillicoresPerPod) * 100;
}

/**
 * The evidence this incident actually offers, read from the live cluster.
 *
 * Deliberately the same set for every drill rather than a per-scenario script. A learner who is
 * shown a curated three-item list for each incident learns which list goes with which incident;
 * a learner shown the whole instrument panel every time learns to read the instrument panel.
 */
export function evidenceFor(
  run: LiveRunView,
  components: RunComponent[],
): EvidenceItem[] {
  const by = (name: string) => components.find((c) => c.name === name);
  const gatewayCpu = tierUtilisation(by("envoy"));
  const checkoutCpu = tierUtilisation(by("checkout"));

  const items: EvidenceItem[] = [
    {
      id: "throughput",
      label: "Offered against served",
      value: `${run.offeredRequestsPerSec}/s offered · ${run.telemetry.requestsPerSec}/s served`,
      question:
        "Is the system keeping up with demand, or is a share of it never being answered?",
      tier: null,
    },
    {
      id: "latency",
      label: "p95 latency",
      value: `${ms(run.telemetry.p95LatencyMs)} against a ${run.telemetry.latencyTargetMs} ms target`,
      question:
        "Are the requests that do get served waiting somewhere, or are they simply slow?",
      tier: null,
    },
    {
      id: "errors",
      label: "Error rate",
      value: `${run.telemetry.errorRatePct.toFixed(2)}%`,
      question:
        "Do failures scale with load (capacity) or hold a steady proportion (code)?",
      tier: null,
    },
    {
      id: "checkout-cpu",
      label: "Checkout utilisation",
      value:
        checkoutCpu === null
          ? "no ready pods"
          : `${pct(checkoutCpu)} of limit · ${run.telemetry.apiReplicas} replicas`,
      question:
        "Has the application tier run out of the resource it consumes, or is it idle?",
      tier: "checkout",
    },
    {
      id: "gateway-cpu",
      label: "Gateway utilisation",
      value:
        gatewayCpu === null
          ? "no ready pods"
          : `${pct(gatewayCpu)} of limit · ${run.gatewayReplicas} replicas`,
      question:
        "Is the front door admitting everything that arrives, or is the queue in front of it?",
      tier: "envoy",
    },
    {
      id: "release",
      label: "Release track",
      value: run.releaseTrack,
      question: "Which build is answering requests right now?",
      tier: "checkout",
    },
    {
      id: "data",
      label: "Catalogue state",
      value: run.dataState,
      question:
        "Is the data being served correct? Nothing in latency or status codes answers this.",
      tier: "postgres",
    },
    {
      id: "cache",
      label: "Cache",
      value: run.telemetry.cacheActive ? "enabled" : "disabled",
      question:
        "How much of the request path is reaching the data tier at all — and what might that be hiding?",
      tier: "redis",
    },
  ];

  // Only offered when there is something to read. A canary row on a drill with no canary is a
  // distraction, and a placement row is meaningless before any pod has been scheduled.
  if (run.canaryReplicas > 0 || run.drillId.includes("canary"))
    items.push({
      id: "canary",
      label: "Canary exposure",
      value: `${run.canaryReplicas} canary · ${run.telemetry.apiReplicas} stable`,
      question:
        "What share of traffic is on the candidate build, and what is that costing the error budget?",
      tier: "checkout-canary",
    });

  const placed = by("checkout")?.pods.filter((p) => p.pool.length > 0) ?? [];
  if (placed.length > 0)
    items.push({
      id: "placement",
      label: "Measured placement",
      value: summarisePools(placed.map((p) => p.pool)),
      question:
        "Where are the pods actually running? The target pool is what you asked for, not what happened.",
      tier: "checkout",
    });

  return items;
}

function summarisePools(pools: string[]): string {
  const counts = new Map<string, number>();
  for (const pool of pools) counts.set(pool, (counts.get(pool) ?? 0) + 1);
  return [...counts].map(([pool, n]) => `${n} on ${pool}`).join(" · ");
}

/** The tiers a learner can blame. One entry per place a queue or a fault can live. */
export function hypothesesFor(run: LiveRunView): HypothesisOption[] {
  const options: HypothesisOption[] = [
    {
      id: "checkout",
      label: "The application tier is out of capacity",
      tier: "checkout",
      predicts:
        "Served throughput rises towards offered and p95 falls, once new replicas are ready.",
    },
    {
      id: "envoy",
      label: "The gateway is the constraint",
      tier: "envoy",
      predicts:
        "Served throughput rises and checkout utilisation goes UP, because traffic finally reaches it.",
    },
    {
      id: "release",
      label: "A bad release is running",
      tier: "checkout",
      predicts:
        "The error rate falls after the rollback. Latency may not move — it was never the symptom.",
    },
    {
      id: "data",
      label: "The data tier is serving bad reads",
      tier: "postgres",
      predicts:
        "Catalogue state reads recovered and the error rate falls with it, through live traffic.",
    },
  ];

  if (run.canaryReplicas > 0 || run.drillId.includes("canary"))
    options.push({
      id: "canary",
      label: "The canary is failing its share of traffic",
      tier: "checkout-canary",
      predicts:
        "The blended error rate falls when the canary goes to zero — and capacity falls with it.",
    });

  return options;
}

export interface CoachingRecord {
  /** What the learner said was wrong, before they acted. */
  hypothesisId: string | null;
  hypothesisLabel: string | null;
  /** Evidence ids inspected, in the order they were opened. */
  inspected: string[];
  /** Measured state when the drill's controls unlocked, to compare the ending against. */
  opening: {
    offered: number;
    served: number;
    p95: number;
    errors: number;
  } | null;
}

export interface CoachingInputs {
  run: LiveRunView;
  /** The underlying drill phase, which already knows about missteps, holds and solves. */
  drillPhase: string;
  inspected: Set<string>;
  evidenceCount: number;
  /**
   * The learner has said they are done reading.
   *
   * Separate from "enough has been inspected" so the screen does not vanish out from under
   * someone the instant they open the sixth card. The threshold decides when they MAY move on;
   * this decides when they DO — and reading the rest of the panel first is behaviour to
   * encourage, not to interrupt.
   */
  evidenceDone: boolean;
  hypothesis: string | null;
  briefingRead: boolean;
  /** Set while a decision's consequence has landed and not been acknowledged. */
  unreadConsequence: boolean;
}

/**
 * Where the learner is in the teaching flow.
 *
 * Layered over the existing drill phase rather than replacing it: solved, misstep and holding are
 * still decided by the broker's view of the cluster, and this only decides what to put on screen
 * before and around them.
 */
export function coachingPhase(input: CoachingInputs): CoachingPhase {
  const { run, drillPhase } = input;

  if (drillPhase === "solved" || run.drillSolved) return "debrief";
  if (drillPhase === "misstep" || input.unreadConsequence) return "consequence";
  if (!input.briefingRead) return "briefing";
  if (
    !input.evidenceDone ||
    !evidenceSatisfied(input.inspected.size, input.evidenceCount)
  )
    return "observe";
  if (input.hypothesis === null) return "hypothesise";
  if (drillPhase === "holding") return "verify";
  return "act";
}

export function evidenceSatisfied(inspected: number, total: number): boolean {
  if (total === 0) return true;
  return inspected >= Math.ceil(total * EVIDENCE_FRACTION);
}

export function evidenceRemaining(inspected: number, total: number): number {
  return Math.max(0, Math.ceil(total * EVIDENCE_FRACTION) - inspected);
}

/**
 * Whether the operator's controls should accept input. The gate is evidence, never a clock.
 *
 * Not `consequence`: while a decision's measured effect is being read, that screen owns the panel
 * and the console is not on it. This is the single source of truth for the rule — `useCoaching`
 * calls it rather than restating it, so the two cannot drift.
 */
export function decisionsUnlocked(phase: CoachingPhase): boolean {
  return phase === "act" || phase === "verify";
}

// ── Debrief ────────────────────────────────────────────────────────────────

export interface DebriefStep {
  kind: "hypothesis" | "action";
  label: string;
  /** Actions only: whether it addressed the cause. */
  correct?: boolean;
  detail: string;
}

export interface Debrief {
  solved: boolean;
  clean: boolean;
  elapsedMs: number;
  /** Ordered, oldest first — the story of the incident as the learner worked it. */
  timeline: DebriefStep[];
  /** The measured signals, then and now. */
  before: CoachingRecord["opening"];
  after: { offered: number; served: number; p95: number; errors: number };
  /** The causal sentence. Written from what actually happened, not from a template per drill. */
  causalChain: string;
  keyLesson: string;
  unnecessary: string[];
}

/**
 * The result screen's content, derived from what the learner did.
 *
 * The point is to avoid "correct / incorrect". A debrief that says "you identified the application
 * tier from high CPU and a served/offered shortfall; scaling checkout restored throughput; the
 * gateway stayed below saturation, which confirms it was not the constraint" teaches something. A
 * green tick does not.
 */
export function buildDebrief(
  run: LiveRunView,
  record: CoachingRecord,
  history: DecisionRecord[],
  hypotheses: HypothesisOption[],
): Debrief {
  // History is newest-first everywhere else; a debrief is a story, so it reads forwards.
  const applied = [...history].reverse();
  const wrong = applied.filter((h) => !h.correct);
  const right = applied.filter((h) => h.correct);

  const chosen = hypotheses.find((h) => h.id === record.hypothesisId) ?? null;

  const timeline: DebriefStep[] = [];
  if (chosen)
    timeline.push({
      kind: "hypothesis",
      label: `You said: ${chosen.label}`,
      detail: `You predicted: ${chosen.predicts}`,
    });
  for (const step of applied)
    timeline.push({
      kind: "action",
      label: step.label,
      correct: step.correct,
      detail: step.impact.length
        ? step.impact.map((i) => `${i.label} ${i.from} → ${i.to}`).join(" · ")
        : "No change to the cluster's desired state.",
    });

  const after = {
    offered: run.offeredRequestsPerSec,
    served: run.telemetry.requestsPerSec,
    p95: run.telemetry.p95LatencyMs,
    errors: run.telemetry.errorRatePct,
  };

  return {
    solved: run.drillSolved,
    clean: wrong.length === 0,
    elapsedMs: run.elapsedMs,
    timeline,
    before: record.opening,
    after,
    causalChain: causalChain(record, right, wrong, chosen, after),
    keyLesson: keyLesson(wrong.length > 0, chosen, record),
    unnecessary: wrong.map((w) => w.label),
  };
}

function causalChain(
  record: CoachingRecord,
  right: DecisionRecord[],
  wrong: DecisionRecord[],
  chosen: HypothesisOption | null,
  after: Debrief["after"],
): string {
  const parts: string[] = [];

  if (record.opening && after.served > record.opening.served)
    parts.push(
      `Served throughput went from ${record.opening.served}/s to ${after.served}/s against ${after.offered}/s offered.`,
    );
  if (record.opening && after.p95 < record.opening.p95)
    parts.push(`p95 fell from ${ms(record.opening.p95)} to ${ms(after.p95)}.`);
  if (record.opening && after.errors < record.opening.errors - 0.2)
    parts.push(
      `The error rate fell from ${record.opening.errors.toFixed(2)}% to ${after.errors.toFixed(2)}%.`,
    );

  if (right.length > 0)
    parts.push(
      `${right.map((r) => r.label).join(" and ")} addressed the cause.`,
    );

  if (chosen)
    parts.push(
      wrong.length === 0
        ? `Your hypothesis — ${chosen.label.toLowerCase()} — held up, and the signal you predicted is the one that moved.`
        : `Your hypothesis was ${chosen.label.toLowerCase()}. The measurements after your first action are what corrected it.`,
    );

  if (wrong.length > 0)
    parts.push(
      `${wrong.map((w) => w.label).join(" and ")} changed the cluster without addressing the cause — the signal that would have moved did not.`,
    );

  return parts.join(" ");
}

function keyLesson(
  hadWrong: boolean,
  chosen: HypothesisOption | null,
  record: CoachingRecord,
): string {
  if (hadWrong)
    return "A wrong action is real: it changed the cluster and the measurements are what told you so. Re-read the tiers after every change — the system after your action is a different system from the one you diagnosed.";
  if (record.inspected.length >= 6)
    return "You read the instrument panel before touching anything, and the first action was the right one. That order is the whole skill.";
  if (chosen)
    return "Naming the fault before acting is what makes the result interpretable: you knew which signal to watch, so you knew the fix had worked rather than hoping it had.";
  return "Recovery is an observed outcome held over time, not a correct button. The objective resolved because the cluster genuinely reached the target state.";
}
