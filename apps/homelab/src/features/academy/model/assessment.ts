import {
  assessmentUnitId,
  checkpointUnitId,
  drillTitle,
  drillUnitId,
  lessonUnitId,
  SKILL_LABELS,
  type LearningCourse,
  type SkillDomain,
} from "./course";
import {
  eligibility,
  isComplete,
  unitOf,
  type CourseProgress,
  type CourseState,
  type Requirement,
} from "./progress";
import { assessmentLockReason, assessmentUnlocked } from "./unlocks";

// The final assessment, as data.
//
// The assessment is one real drill — `double-fault`, on a real disposable cluster, judged by the
// platform — but the *experience* around it is course-wide: it is the only unit that belongs to no
// segment, and it is the last thing standing between a learner and the certificate. Everything on
// this page that is not the cluster itself is computed here, as pure functions over the same
// progress model the rest of the Academy uses.
//
// The rule this file is written against: nothing here invents a measurement. The blueprint says
// which domains the course covers and what the scenario can actually surface of each one; it does
// not report a per-domain score, because the backend does not measure one and a plausible-looking
// percentage is worse than no percentage at all.

/** The dedicated assessment page. The course path's final CTA opens this rather than the drill. */
export const ASSESSMENT_HREF = "/practice/assessment";

/** Where the assessment actually runs: the existing Academy practice path, in assessment mode. */
export function assessmentDrillHref(course: LearningCourse): string {
  return `/practice/drill/${course.finalAssessmentDrillId}?assessment=1`;
}

/**
 * The skill labels the assessment handoff carries.
 *
 * Every domain the course teaches, in course order. The assessment passes no segment because it
 * belongs to none — before this, the handoff carried an empty list, which read as "this assesses
 * nothing" on the one unit that assesses everything.
 */
export function assessmentSkills(course: LearningCourse): string[] {
  return course.segments.map((segment) => SKILL_LABELS[segment.domain]);
}

// ── The rules, said before the cluster exists ──────────────────────────────

export interface AssessmentRule {
  id: string;
  label: string;
  detail: string;
}

/**
 * What the learner is told up front.
 *
 * Held as data rather than as prose in the component so the claims can be asserted: every line
 * here is either a property of the platform or a property of the scenario, and none of them is a
 * promise about what the result is worth outside this site.
 */
export const ASSESSMENT_RULES: AssessmentRule[] = [
  {
    id: "unranked",
    label: "Unranked and retryable",
    detail:
      "This is practice. It never touches ELO, it is never compared with anyone else, and it may be run as many times as you like.",
  },
  {
    id: "real-cluster",
    label: "A real disposable cluster",
    detail:
      "The same live homelab every capstone uses: a real Kubernetes namespace, provisioned for this attempt and torn down afterwards.",
  },
  {
    id: "multi-fault",
    label: "More than one fault",
    detail:
      "There is more than one thing wrong at the same time, and no indication of which order to take them in.",
  },
  {
    id: "unlabelled",
    label: "No segment labels",
    detail:
      "You are not told which part of the course a fault belongs to. Working that out is the assessment.",
  },
  {
    id: "applied",
    label: "Your actions are really applied",
    detail:
      "Every operational action is applied to the cluster. A wrong one is applied too — it does not end the run, and you are shown what it measured.",
  },
  {
    id: "measured",
    label: "The platform judges the outcome",
    detail:
      "The objective is resolved server-side from measured telemetry, not from which buttons you pressed or in what order.",
  },
  {
    id: "explained-after",
    label: "Explanations come afterwards",
    detail:
      "No coaching callouts before an operational decision. The full debrief — the causal chain, the before-and-after numbers, every decision you took — arrives once the run is over.",
  },
];

// ── Blueprint ──────────────────────────────────────────────────────────────

export interface BlueprintRow {
  domain: SkillDomain;
  label: string;
  segmentId: string;
  segmentOrder: number;
  segmentTitle: string;
  /** What this domain contributes to working the assessment. Prose, not a score. */
  contributes: string;
  /** True once the segment's own capstone was solved. Recorded before the assessment, not by it. */
  demonstrated: boolean;
}

/**
 * What each domain is for during the assessment.
 *
 * Deliberately phrased as a capability the learner brings, not as a thing the run grades. Two
 * faults on one cluster cannot independently prove seven domains, and saying otherwise would be
 * the same kind of claim the certificate disclaimer exists to avoid.
 */
const CONTRIBUTION: Record<SkillDomain, string> = {
  observability:
    "Reading the run at all: which tier is actually constrained, and which signal is only a symptom of the one next to it.",
  capacity:
    "Telling a tier that is short of replicas from a tier that is failing for a reason more capacity will not fix.",
  releases:
    "Recognising a change as the thing that moved, and knowing what reverting it does and does not undo.",
  data: "Deciding whether the tier behind the request is serving, stale, or quietly masking something worse.",
  scheduling:
    "Working out whether a workload is where it was asked to be, and what it costs to move it while load is on.",
  gateways:
    "Following the request from the front door inwards, so a queue at the edge is not mistaken for a slow backend.",
  "progressive-delivery":
    "Separating a partial rollout from a fleet-wide fault when both are visible in the same numbers.",
};

/** The seven domains, with what each one is doing during the assessment. */
export function assessmentBlueprint(
  course: LearningCourse,
  state: CourseState,
): BlueprintRow[] {
  return course.segments.map((segment) => ({
    domain: segment.domain,
    label: SKILL_LABELS[segment.domain],
    segmentId: segment.id,
    segmentOrder: segment.order,
    segmentTitle: segment.title,
    contributes: CONTRIBUTION[segment.domain],
    demonstrated:
      state.skills.find((s) => s.domain === segment.domain)?.demonstrated ??
      false,
  }));
}

/** The honest limit of what one scenario shows. Rendered on the page and asserted by a test. */
export const BLUEPRINT_CAVEAT =
  "One scenario cannot independently prove professional mastery of all seven domains, and this page does not claim it does. Each domain is proven by its own capstone; the assessment tests whether you can combine them under ambiguity, with nothing telling you which one you are looking at.";

// ── Readiness ──────────────────────────────────────────────────────────────

export interface OutstandingSegment {
  segmentId: string;
  order: number;
  title: string;
  /** Straight back to the work, not to a generic index. */
  href: string;
  /** Everything still missing in this segment, in the order it is done. */
  missing: string[];
}

/**
 * Exactly what is still incomplete, per segment, with somewhere to go about it.
 *
 * `assessmentLockReason` gives one sentence, which is right for a banner and useless as a to-do
 * list. A learner who is four capstones from the assessment should not have to work out which four.
 */
export function outstandingWork(
  course: LearningCourse,
  progress: CourseProgress,
): OutstandingSegment[] {
  return course.segments.flatMap((segment) => {
    const lessonsLeft = segment.lessons.filter(
      (l) => !isComplete(progress, lessonUnitId(l.id)),
    ).length;
    const checkpointLeft = !isComplete(progress, checkpointUnitId(segment.id));
    const capstoneLeft = !isComplete(
      progress,
      drillUnitId(segment.id, segment.capstoneDrillId),
    );

    const missing: string[] = [];
    if (lessonsLeft > 0)
      missing.push(
        `${lessonsLeft} of ${segment.lessons.length} ${
          lessonsLeft === 1 ? "lesson" : "lessons"
        } left`,
      );
    if (checkpointLeft) missing.push("checkpoint not taken");
    if (capstoneLeft)
      missing.push(
        `capstone not solved — ${drillTitle(segment.capstoneDrillId)}`,
      );

    if (missing.length === 0) return [];

    // Straight to the piece of work that is actually outstanding: the checkpoint anchor when only
    // the checkpoint is left, the segment page otherwise.
    const href =
      lessonsLeft === 0 && checkpointLeft
        ? `/practice/segment/${segment.id}#checkpoint`
        : `/practice/segment/${segment.id}`;

    return [
      {
        segmentId: segment.id,
        order: segment.order,
        title: segment.title,
        href,
        missing,
      },
    ];
  });
}

/**
 * Which of the three states the launch control is in.
 *
 * `completed` and `retry` are the same unlock but not the same screen: one is a course that is
 * finished, the other is an attempt that is still worth making, and collapsing them is how a
 * learner ends up unsure whether the thing they just did counted.
 */
export type AssessmentStage = "locked" | "first-attempt" | "retry";

export interface AssessmentStanding {
  stage: AssessmentStage;
  unlocked: boolean;
  /** True once the assessment unit itself is recorded complete. */
  completed: boolean;
  /** An attempt was opened and has not been completed. The launch control offers to resume it. */
  started: boolean;
  attempts: number;
  bestElapsedMs: number | null;
  /** The recorded attempt had no wrong operational action. Sticky across a messier retry. */
  clean: boolean;
  completedUtc: string | null;
  /** One sentence for a banner. Empty when unlocked. */
  lockedBecause: string;
  /** The same thing as a to-do list with links. Empty when unlocked. */
  outstanding: OutstandingSegment[];
  /** The label the launch control should carry. */
  actionLabel: string;
  certificate: CertificateStanding;
}

export interface CertificateStanding {
  eligible: boolean;
  /** Requirements not yet met, so the page can name them rather than say "not yet". */
  remaining: Requirement[];
  /** Already issued against the account. */
  issued: boolean;
  /**
   * Progress is only in this browser, so no certificate can be issued from it whatever else is
   * complete. Called out separately because it is the one requirement that is not about the course.
   */
  accountBacked: boolean;
}

export function certificateStanding(
  course: LearningCourse,
  progress: CourseProgress,
  state: CourseState,
): CertificateStanding {
  const { eligible, requirements } = eligibility(course, progress, state);
  return {
    eligible,
    remaining: requirements.filter((r) => !r.met),
    issued: progress.certificate !== null,
    accountBacked: progress.accountBacked,
  };
}

export function assessmentStanding(
  course: LearningCourse,
  progress: CourseProgress,
  state: CourseState,
): AssessmentStanding {
  const unitId = assessmentUnitId(course.finalAssessmentDrillId);
  const unit = unitOf(progress, unitId);
  const unlocked = assessmentUnlocked(course, progress);
  const completed = isComplete(progress, unitId);
  // Any record at all means this is not a first attempt: `markStarted` writes an in-progress row
  // before the cluster is even provisioned, and treating that as untouched is what would lose a
  // half-finished run behind a button labelled "begin".
  const started = unit !== null && !completed;

  const stage: AssessmentStage = !unlocked
    ? "locked"
    : unit !== null
      ? "retry"
      : "first-attempt";

  return {
    stage,
    unlocked,
    completed,
    started,
    attempts: unit?.attempts ?? 0,
    bestElapsedMs: unit?.bestElapsedMs ?? null,
    clean: unit?.clean ?? false,
    completedUtc: unit?.completedUtc ?? null,
    lockedBecause: unlocked ? "" : assessmentLockReason(course, progress),
    outstanding: unlocked ? [] : outstandingWork(course, progress),
    actionLabel: !unlocked
      ? "Locked"
      : completed
        ? "Run the assessment again"
        : started
          ? "Resume the final assessment"
          : "Begin final assessment",
    certificate: certificateStanding(course, progress, state),
  };
}

/**
 * What the page reads out when the standing resolves.
 *
 * The launch control's state arrives after an async progress load, so something has to say what it
 * landed on for a learner who is not looking at the button.
 */
export function standingAnnouncement(standing: AssessmentStanding): string {
  if (!standing.unlocked)
    return `Final assessment locked. ${standing.lockedBecause}`;
  if (standing.completed)
    return standing.certificate.eligible
      ? "Final assessment complete. Every certificate requirement is met."
      : `Final assessment complete. ${standing.certificate.remaining.length} certificate ${
          standing.certificate.remaining.length === 1
            ? "requirement remains"
            : "requirements remain"
        }.`;
  if (standing.started)
    return "Final assessment unlocked. An attempt is already on record and can be resumed.";
  return "Final assessment unlocked and ready to begin.";
}
