import {
  checkpointUnitId,
  courseUnits,
  drillUnitId,
  lessonUnitId,
  assessmentUnitId,
  SKILL_LABELS,
  type LearningCourse,
  type LearningSegment,
  type SkillDomain,
  type UnitType,
} from "./course";

// Learning state. Deliberately a separate domain from cluster state.
//
// `LiveRunView` describes a Kubernetes namespace at one instant; this describes what a person has
// learned, which outlives every cluster they ever provisioned. Nothing here polls, and nothing here
// belongs in the run view — mixing them is how a torn-down cluster ends up erasing a course.

export type UnitStatus =
  "locked" | "available" | "in-progress" | "completed" | "mastered";

export interface UnitProgress {
  unitId: string;
  unitType: UnitType;
  status: UnitStatus;
  /** Checkpoints only: percentage correct, 0–100. Null everywhere else. */
  score: number | null;
  attempts: number;
  /** Drills only: the best real-cluster time recorded for this unit. */
  bestElapsedMs: number | null;
  /**
   * Drills only: this unit was completed without a wrong operational action. Five of seven clean
   * capstones is a certificate requirement, so it is recorded per unit rather than recomputed —
   * a later messy retry must not erase a clean solve that already happened.
   */
  clean: boolean;
  completedUtc: string | null;
}

export interface IssuedCertificate {
  certificateId: string;
  courseId: string;
  courseVersion: number;
  learnerName: string;
  issuedUtc: string;
  skills: string[];
}

export interface CourseProgress {
  courseId: string;
  courseVersion: number;
  startedUtc: string | null;
  completedUtc: string | null;
  lastActivityUtc: string | null;
  units: Record<string, UnitProgress>;
  certificate: IssuedCertificate | null;
  /**
   * Whether this progress is attached to a signed-in account. Local-only progress is real progress
   * — a visitor can learn without an account — but it can never earn a certificate, because a
   * certificate the browser could mint for itself is not worth issuing.
   */
  accountBacked: boolean;
}

export function emptyProgress(course: LearningCourse): CourseProgress {
  return {
    courseId: course.id,
    courseVersion: course.version,
    startedUtc: null,
    completedUtc: null,
    lastActivityUtc: null,
    units: {},
    certificate: null,
    accountBacked: false,
  };
}

export function unitOf(
  progress: CourseProgress,
  unitId: string,
): UnitProgress | null {
  return progress.units[unitId] ?? null;
}

export function isComplete(progress: CourseProgress, unitId: string): boolean {
  const unit = progress.units[unitId];
  return unit?.status === "completed" || unit?.status === "mastered";
}

/**
 * Progress stored against an older version of the course is kept, not discarded: completing
 * version 1 remains a historical fact. It simply stops counting towards the current version's
 * requirements, which is the honest reading of "the course changed".
 */
export function isCurrentVersion(
  progress: CourseProgress,
  course: LearningCourse,
): boolean {
  return (
    progress.courseId === course.id && progress.courseVersion === course.version
  );
}

// ── Segment aggregation ────────────────────────────────────────────────────

export type SegmentStatus =
  | "locked"
  | "available"
  | "in-progress"
  /** Every lesson and the checkpoint are done; the real-cluster capstone is not. */
  | "drill-pending"
  | "complete"
  /** Complete, plus the optional harder drill on the same skill. */
  | "mastered";

export interface SegmentState {
  segmentId: string;
  status: SegmentStatus;
  lessonsTotal: number;
  lessonsComplete: number;
  checkpointScore: number | null;
  checkpointComplete: boolean;
  capstoneComplete: boolean;
  capstoneClean: boolean;
  masteryComplete: boolean;
  /** 0–1 across lessons, checkpoint and capstone — what the course map's progress line draws. */
  fraction: number;
  /** The next thing to do in this segment, or null when there is nothing left. */
  next:
    | { kind: "lesson"; lessonId: string; title: string }
    | { kind: "checkpoint"; title: string }
    | { kind: "drill"; drillId: string; title: string }
    | null;
}

export function segmentState(
  course: LearningCourse,
  segment: LearningSegment,
  progress: CourseProgress,
  unlocked: boolean,
): SegmentState {
  const lessonsTotal = segment.lessons.length;
  const lessonsComplete = segment.lessons.filter((l) =>
    isComplete(progress, lessonUnitId(l.id)),
  ).length;

  const checkpoint = unitOf(progress, checkpointUnitId(segment.id));
  const checkpointComplete = isComplete(progress, checkpointUnitId(segment.id));

  const capstoneUnit = unitOf(
    progress,
    drillUnitId(segment.id, segment.capstoneDrillId),
  );
  const capstoneComplete = isComplete(
    progress,
    drillUnitId(segment.id, segment.capstoneDrillId),
  );
  const masteryComplete = segment.masteryDrillId
    ? isComplete(progress, drillUnitId(segment.id, segment.masteryDrillId))
    : false;

  // Three equal parts: the reading, the reasoning, and the real cluster. A learner who has read
  // everything but not touched a cluster is two thirds of the way through, and the map should say
  // so rather than showing a nearly-full bar for work that has not been proven.
  const parts =
    (lessonsTotal === 0 ? 1 : lessonsComplete / lessonsTotal) +
    (checkpointComplete ? 1 : 0) +
    (capstoneComplete ? 1 : 0);
  const fraction = parts / 3;

  const nextLesson = segment.lessons.find(
    (l) => !isComplete(progress, lessonUnitId(l.id)),
  );
  const next: SegmentState["next"] = nextLesson
    ? { kind: "lesson", lessonId: nextLesson.id, title: nextLesson.title }
    : !checkpointComplete
      ? { kind: "checkpoint", title: `${segment.title} checkpoint` }
      : !capstoneComplete
        ? {
            kind: "drill",
            drillId: segment.capstoneDrillId,
            title: "Real-cluster capstone",
          }
        : null;

  const status: SegmentStatus = !unlocked
    ? "locked"
    : masteryComplete
      ? "mastered"
      : capstoneComplete && checkpointComplete
        ? "complete"
        : lessonsComplete === lessonsTotal && checkpointComplete
          ? "drill-pending"
          : lessonsComplete > 0 || checkpoint !== null || capstoneUnit !== null
            ? "in-progress"
            : "available";

  return {
    segmentId: segment.id,
    status,
    lessonsTotal,
    lessonsComplete,
    checkpointScore: checkpoint?.score ?? null,
    checkpointComplete,
    capstoneComplete,
    capstoneClean: capstoneUnit?.clean ?? false,
    masteryComplete,
    fraction,
    next,
  };
}

export const SEGMENT_STATUS_LABELS: Record<SegmentStatus, string> = {
  locked: "Locked",
  available: "Available",
  "in-progress": "In progress",
  "drill-pending": "Capstone pending",
  complete: "Complete",
  mastered: "Mastered",
};

// ── Course aggregation ─────────────────────────────────────────────────────

export interface SkillState {
  domain: SkillDomain;
  label: string;
  /** 0–1. Reading moves it a little; a clean real-cluster capstone moves it a lot. */
  level: number;
  demonstrated: boolean;
}

export interface CourseState {
  segments: SegmentState[];
  segmentsComplete: number;
  segmentsTotal: number;
  unitsComplete: number;
  unitsTotal: number;
  /** 0–100 across every knowledge check that has been answered. */
  checkScore: number | null;
  capstonesComplete: number;
  cleanCapstones: number;
  assessmentComplete: boolean;
  skills: SkillState[];
  /** Where "Continue learning" goes. Null once the whole course is finished. */
  resume: {
    segmentId: string;
    label: string;
    href: string;
  } | null;
}

export function courseState(
  course: LearningCourse,
  progress: CourseProgress,
  unlockedIds: ReadonlySet<string>,
): CourseState {
  const segments = course.segments.map((segment) =>
    segmentState(course, segment, progress, unlockedIds.has(segment.id)),
  );

  const units = courseUnits(course);
  const unitsComplete = units.filter((u) => isComplete(progress, u.id)).length;

  // The score is over checkpoints actually taken. An untaken checkpoint is not a zero — it is a
  // thing that has not happened, and averaging it in would make the number mean "how much of the
  // course have you done" rather than "how well did you reason about it".
  const scored = course.segments
    .map((s) => unitOf(progress, checkpointUnitId(s.id)))
    .filter((u): u is UnitProgress => u !== null && u.score !== null);
  const checkScore =
    scored.length === 0
      ? null
      : Math.round(
          scored.reduce((sum, u) => sum + (u.score ?? 0), 0) / scored.length,
        );

  const capstonesComplete = segments.filter((s) => s.capstoneComplete).length;
  const cleanCapstones = segments.filter((s) => s.capstoneClean).length;
  const assessmentComplete = isComplete(
    progress,
    assessmentUnitId(course.finalAssessmentDrillId),
  );

  const skills = course.segments.map((segment) => {
    const state = segments.find((s) => s.segmentId === segment.id)!;
    // Weighted so the level says what it looks like it says. Reading everything without proving it
    // on a cluster tops out below half; the capstone is what makes a skill "demonstrated".
    const level =
      0.25 *
        (state.lessonsTotal ? state.lessonsComplete / state.lessonsTotal : 0) +
      0.2 *
        (state.checkpointComplete ? (state.checkpointScore ?? 0) / 100 : 0) +
      0.4 * (state.capstoneComplete ? 1 : 0) +
      0.15 * (state.masteryComplete ? 1 : 0);
    return {
      domain: segment.domain,
      label: SKILL_LABELS[segment.domain],
      level: Math.min(1, level),
      demonstrated: state.capstoneComplete,
    };
  });

  const resumeSegment = segments.find(
    (s) =>
      (s.status === "available" ||
        s.status === "in-progress" ||
        s.status === "drill-pending") &&
      s.next !== null,
  );
  const resumeDefinition = resumeSegment
    ? course.segments.find((s) => s.id === resumeSegment.segmentId)!
    : null;

  const resume =
    resumeSegment && resumeDefinition && resumeSegment.next
      ? {
          segmentId: resumeSegment.segmentId,
          label:
            resumeSegment.next.kind === "lesson"
              ? resumeSegment.next.title
              : resumeSegment.next.kind === "checkpoint"
                ? `${resumeDefinition.title} checkpoint`
                : `${resumeDefinition.title} capstone`,
          href:
            resumeSegment.next.kind === "lesson"
              ? `/practice/lesson/${resumeSegment.next.lessonId}`
              : resumeSegment.next.kind === "checkpoint"
                ? `/practice/segment/${resumeSegment.segmentId}#checkpoint`
                : `/practice/drill/${resumeSegment.next.drillId}?segment=${resumeSegment.segmentId}`,
        }
      : null;

  return {
    segments,
    segmentsComplete: segments.filter(
      (s) => s.status === "complete" || s.status === "mastered",
    ).length,
    segmentsTotal: segments.length,
    unitsComplete,
    unitsTotal: units.length,
    checkScore,
    capstonesComplete,
    cleanCapstones,
    assessmentComplete,
    skills,
    resume,
  };
}

// ── Certificate eligibility ────────────────────────────────────────────────

/** The minimum average across segment checkpoints. */
export const CHECK_SCORE_REQUIRED = 80;
/** How many capstones must have been solved without a wrong operational action. */
export const CLEAN_CAPSTONES_REQUIRED = 5;

export interface Requirement {
  id: string;
  label: string;
  detail: string;
  met: boolean;
  /** For a requirement that is a count, so the page can draw progress rather than a tick. */
  progress: { have: number; need: number } | null;
}

export interface Eligibility {
  eligible: boolean;
  requirements: Requirement[];
}

/**
 * What the certificate actually asserts, checked against persisted progress.
 *
 * Every requirement here is something the learner did, not something the browser remembered: the
 * capstones and the final assessment are real drills solved on a real disposable cluster, and the
 * account gate exists because a certificate minted from localStorage would be an image, not a
 * record.
 */
export function eligibility(
  course: LearningCourse,
  progress: CourseProgress,
  state: CourseState,
): Eligibility {
  const lessonsTotal = course.segments.reduce(
    (n, s) => n + s.lessons.length,
    0,
  );
  const lessonsComplete = course.segments.reduce(
    (n, s) =>
      n +
      s.lessons.filter((l) => isComplete(progress, lessonUnitId(l.id))).length,
    0,
  );
  const checkpointsTotal = course.segments.length;
  const checkpointsComplete = state.segments.filter(
    (s) => s.checkpointComplete,
  ).length;

  const requirements: Requirement[] = [
    {
      id: "account",
      label: "Signed in",
      detail:
        "Course progress is recorded against your account. A certificate is not issued from browser storage.",
      met: progress.accountBacked,
      progress: null,
    },
    {
      id: "lessons",
      label: "Every lesson completed",
      detail: "All lessons across the seven segments.",
      met: lessonsComplete >= lessonsTotal,
      progress: { have: lessonsComplete, need: lessonsTotal },
    },
    {
      id: "checkpoints",
      label: "Every segment checkpoint taken",
      detail: "One knowledge checkpoint per segment.",
      met: checkpointsComplete >= checkpointsTotal,
      progress: { have: checkpointsComplete, need: checkpointsTotal },
    },
    {
      id: "score",
      label: `At least ${CHECK_SCORE_REQUIRED}% across knowledge checks`,
      detail: "Averaged over every segment checkpoint.",
      met:
        checkpointsComplete >= checkpointsTotal &&
        (state.checkScore ?? 0) >= CHECK_SCORE_REQUIRED,
      progress: {
        have: state.checkScore ?? 0,
        need: CHECK_SCORE_REQUIRED,
      },
    },
    {
      id: "capstones",
      label: "Every segment capstone solved",
      detail: "Each on a real, disposable Kubernetes cluster.",
      met: state.capstonesComplete >= course.segments.length,
      progress: {
        have: state.capstonesComplete,
        need: course.segments.length,
      },
    },
    {
      id: "clean",
      label: `${CLEAN_CAPSTONES_REQUIRED} capstones solved with no wrong action`,
      detail:
        "A wrong operational action never ends a practice drill, but a clean solve is what this counts.",
      met: state.cleanCapstones >= CLEAN_CAPSTONES_REQUIRED,
      progress: {
        have: state.cleanCapstones,
        need: CLEAN_CAPSTONES_REQUIRED,
      },
    },
    {
      id: "assessment",
      label: "Final assessment completed",
      detail: `${course.finalAssessmentTitle} — multi-domain, unranked, retryable.`,
      met: state.assessmentComplete,
      progress: null,
    },
  ];

  return {
    eligible: requirements.every((r) => r.met),
    requirements,
  };
}

/** The skills a certificate lists: the domains whose capstone was actually solved. */
export function demonstratedSkills(state: CourseState): string[] {
  return state.skills.filter((s) => s.demonstrated).map((s) => s.label);
}
