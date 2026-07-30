// The curriculum's shape, said once.
//
// Course content is DATA. Nothing in `content/` renders anything: a lesson is a list of typed
// blocks, and `ui/LessonPlayer` is a switch over the block kind. Adding a lesson is an entry in a
// content file, not a new page component — which is the only way seven segments of material stays
// maintainable by one person.
//
// The vocabulary here is deliberately about teaching rather than about Kubernetes. A block knows it
// is an explanation or a prediction; it does not know what CSS renders it, and it never reaches for
// live cluster state. Live state belongs to the arena; this describes the course.

/** The operational domains the course claims to teach. Drives the skill profile and the
 *  certificate's "skills demonstrated" list. This is Academy mastery — it is not ELO. */
export type SkillDomain =
  | "observability"
  | "capacity"
  | "releases"
  | "data"
  | "scheduling"
  | "gateways"
  | "progressive-delivery";

export const SKILL_LABELS: Record<SkillDomain, string> = {
  observability: "Observability",
  capacity: "Capacity",
  releases: "Releases",
  data: "Data",
  scheduling: "Scheduling",
  gateways: "Gateways",
  "progressive-delivery": "Progressive delivery",
};

/** Which teaching visualization a block wants. The registry in `visuals/` maps these to components,
 *  so content can name a diagram without importing React. */
export type VisualId =
  | "request-path"
  | "offered-vs-served"
  | "desired-vs-observed"
  | "replica-convergence"
  | "queue-formation"
  | "release-tracks"
  | "cache-flow"
  | "drain-migration"
  | "gateway-queue"
  | "canary-split"
  | "goal-hold";

/**
 * Every visualization in `visuals/` is a deterministic teaching illustration built from fixed
 * numbers — not a reading of anyone's cluster. The player labels them as such on screen, because a
 * diagram that looks like a measurement and is not one teaches the wrong lesson twice: once about
 * the system, and once about whether to trust a chart.
 */
export const ILLUSTRATIVE_NOTE =
  "Educational illustration — fixed example values, not live cluster measurements.";

/** One answer to a knowledge check. `why` is shown after answering, for right and wrong alike. */
export interface CheckOption {
  id: string;
  label: string;
  correct: boolean;
  why: string;
}

/**
 * A reasoning question. Never trivia: the options are competing diagnoses, orderings, or claims
 * about evidence, and the explanation is the point of asking.
 */
export interface KnowledgeCheck {
  id: string;
  /** The situation, in the operator's own terms. */
  prompt: string;
  /** Optional measured-looking evidence the learner reasons over. Illustrative, and labelled. */
  evidence?: { label: string; value: string }[];
  options: CheckOption[];
  /** Shown once answered, whatever the answer was — the transferable rule. */
  takeaway: string;
}

/** A "what do you think will happen" step. It is never scored: its job is to make the animation
 *  that follows mean something, and a punished guess is a guess nobody makes honestly. */
export interface Prediction {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
  /** Which option the system actually does — revealed with `because`, not marked right or wrong. */
  actualOptionId: string;
  because: string;
}

export type LearningBlock =
  /** A. Context — one concrete production question, two or three sentences. */
  | { kind: "context"; question: string; body: string }
  /** B. Mental model — one visual, no controls. */
  | { kind: "model"; title: string; visual: VisualId; caption: string }
  /** C. Explain — one idea, one example, one signal to watch for. */
  | {
      kind: "explanation";
      title: string;
      idea: string;
      example: string;
      watchFor: string;
    }
  /** Two states of the same system side by side, in monospace measurements. */
  | {
      kind: "metric-comparison";
      title: string;
      caption: string;
      columns: [string, string];
      rows: { label: string; left: string; right: string; worse?: 0 | 1 }[];
    }
  /** A span tree, for reading a release identifier or a slow tier out of a trace. */
  | {
      kind: "trace-example";
      title: string;
      caption: string;
      spans: {
        name: string;
        service: string;
        durationMs: number;
        depth: number;
        status: "ok" | "error";
      }[];
    }
  /** D. Predict — before the demonstration changes anything. */
  | { kind: "prediction"; prediction: Prediction }
  /** E. Demonstrate — an interactive teaching visualization with a control the learner drives. */
  | {
      kind: "guided-control";
      title: string;
      visual: VisualId;
      caption: string;
      /** The dial the learner turns, e.g. offered load or replica count. */
      control: {
        label: string;
        min: number;
        max: number;
        step: number;
        initial: number;
        unit: string;
      };
      /** What to notice as the dial moves — the reason the control exists. */
      observe: string;
    }
  /** F. Check — one or two reasoning questions. */
  | { kind: "check"; check: KnowledgeCheck }
  /** G. Transfer — what you can now do, and where you will prove it. */
  | {
      kind: "summary";
      canDo: string[];
      /** The capstone or supporting drill this lesson feeds. */
      drillId?: string;
      watchFor?: string;
    };

export interface LearningLesson {
  id: string;
  title: string;
  /** One line under the title in the course map. */
  summary: string;
  estimatedMinutes: number;
  blocks: LearningBlock[];
}

export interface LearningSegment {
  id: string;
  order: number;
  title: string;
  summary: string;
  /** The domain this segment builds. One segment, one primary skill. */
  domain: SkillDomain;
  outcomes: string[];
  /** Segment ids that must be complete first. Empty means available from the start. */
  prerequisites: string[];
  lessons: LearningLesson[];
  /** The real-cluster drill that proves the segment. Must exist in the API drill catalog. */
  capstoneDrillId: string;
  /** Optional harder drill on the same skill. Completing it marks the segment "mastered". */
  masteryDrillId?: string;
  /** Real drills that practise the same skill without gating the segment. */
  supportingDrillIds: string[];
}

export interface LearningCourse {
  id: string;
  version: number;
  title: string;
  /** Shown on the certificate and the dashboard. */
  summary: string;
  estimatedMinutes: number;
  segments: LearningSegment[];
  /** The multi-domain drill that closes the course. Not ranked; retryable. */
  finalAssessmentDrillId: string;
  finalAssessmentTitle: string;
  finalAssessmentSummary: string;
}

// ── Unit identity ──────────────────────────────────────────────────────────
//
// Progress is stored per *unit*, and a unit is any completable thing: a lesson, a segment
// checkpoint, a capstone drill, or the final assessment. Ids are derived rather than hand-written
// so content and progress cannot drift apart — a renamed lesson is a new unit, which is correct.

export type UnitType = "lesson" | "checkpoint" | "drill" | "assessment";

export interface UnitRef {
  id: string;
  type: UnitType;
  segmentId: string | null;
}

export const lessonUnitId = (lessonId: string) => `lesson:${lessonId}`;
export const checkpointUnitId = (segmentId: string) =>
  `checkpoint:${segmentId}`;
export const drillUnitId = (segmentId: string, drillId: string) =>
  `drill:${segmentId}:${drillId}`;
export const assessmentUnitId = (drillId: string) => `assessment:${drillId}`;

/** Every unit the course contains, in the order a learner meets them. */
export function courseUnits(course: LearningCourse): UnitRef[] {
  const units: UnitRef[] = [];
  for (const segment of course.segments) {
    for (const lesson of segment.lessons)
      units.push({
        id: lessonUnitId(lesson.id),
        type: "lesson",
        segmentId: segment.id,
      });
    units.push({
      id: checkpointUnitId(segment.id),
      type: "checkpoint",
      segmentId: segment.id,
    });
    units.push({
      id: drillUnitId(segment.id, segment.capstoneDrillId),
      type: "drill",
      segmentId: segment.id,
    });
  }
  units.push({
    id: assessmentUnitId(course.finalAssessmentDrillId),
    type: "assessment",
    segmentId: null,
  });
  return units;
}

export function findSegment(
  course: LearningCourse,
  segmentId: string,
): LearningSegment | null {
  return course.segments.find((s) => s.id === segmentId) ?? null;
}

export function findLesson(
  course: LearningCourse,
  lessonId: string,
): { segment: LearningSegment; lesson: LearningLesson; index: number } | null {
  for (const segment of course.segments) {
    const index = segment.lessons.findIndex((l) => l.id === lessonId);
    if (index >= 0) return { segment, lesson: segment.lessons[index], index };
  }
  return null;
}

/** Every knowledge check in a segment, in reading order. The checkpoint scores all of them. */
export function segmentChecks(segment: LearningSegment): KnowledgeCheck[] {
  return segment.lessons.flatMap((lesson) =>
    lesson.blocks.flatMap((block) =>
      block.kind === "check" ? [block.check] : [],
    ),
  );
}

/**
 * Human titles for the drills the curriculum points at.
 *
 * Learner-facing text must never show a slug. "You will prove this in checkout-traffic-spike" reads
 * like a config value leaked into a lesson; "in Keep checkout alive" reads like a course. The API
 * catalog owns these titles, but reaching them needs a signed-in fetch, and a lesson has to render
 * before anyone has provisioned anything — so they are mirrored here and the content test asserts
 * the mirror still matches `ScenarioDefinitions.cs`.
 */
export const DRILL_TITLES: Record<string, string> = {
  "checkout-traffic-spike": "Keep checkout alive",
  "checkout-bad-release": "Ship a bad release",
  "catalogue-data-recovery": "Recover the data tier",
  "worker-evacuation": "Evacuate a worker",
  "gateway-saturation": "The queue is at the front door",
  "capacity-right-sizing": "Right-size the fleet",
  "release-under-load": "It only breaks under load",
  "catalogue-cache-mask": "Stop hiding the corruption",
  "pool-return": "Come back from maintenance",
  "double-fault": "Two things are wrong",
  "canary-catch": "Catch it in the canary",
  "canary-and-fleet": "The canary was the least of it",
  "canary-first": "Test it the safe way",
  "cold-start-storm": "Everything restarted at once",
  "front-and-back": "Both ends are tight",
};

/** The drill's title, falling back to a readable form of the id rather than to the id itself. */
export function drillTitle(drillId: string): string {
  return DRILL_TITLES[drillId] ?? drillId.replaceAll("-", " ");
}

/** Every real drill a segment touches, capstone first. Used to map a finished drill back to the
 *  segment it belongs to without a second lookup table. */
export function segmentDrillIds(segment: LearningSegment): string[] {
  return [
    segment.capstoneDrillId,
    ...(segment.masteryDrillId ? [segment.masteryDrillId] : []),
    ...segment.supportingDrillIds,
  ];
}
