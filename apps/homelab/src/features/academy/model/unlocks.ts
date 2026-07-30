import {
  assessmentUnitId,
  checkpointUnitId,
  drillUnitId,
  lessonUnitId,
  type LearningCourse,
  type LearningSegment,
} from "./course";
import { isComplete, type CourseProgress } from "./progress";

// What a learner may open, and why.
//
// The course is a path rather than a corridor. Segment 1 teaches how to read the system and every
// later segment assumes it, so it genuinely comes first; after that the middle of the course is
// open, because someone who already operates production should not have to sit through capacity to
// reach data. Only the two segments that build on earlier ones, and the final assessment, are
// actually gated.

/**
 * A prerequisite is satisfied by understanding, not by cluster time: its lessons and its checkpoint.
 *
 * The capstone deliberately does not gate the next segment. Capstones need a real disposable
 * cluster, the platform runs a small number of them at once, and "all slots are busy" is not a
 * reason to stop someone reading. Capstones gate the certificate instead, which is where proving
 * the skill actually matters.
 */
export function prerequisiteMet(
  segment: LearningSegment,
  progress: CourseProgress,
): boolean {
  const lessonsDone = segment.lessons.every((l) =>
    isComplete(progress, lessonUnitId(l.id)),
  );
  return lessonsDone && isComplete(progress, checkpointUnitId(segment.id));
}

/** Segment ids the learner may open right now. */
export function unlockedSegments(
  course: LearningCourse,
  progress: CourseProgress,
): Set<string> {
  const byId = new Map(course.segments.map((s) => [s.id, s]));
  const open = new Set<string>();

  for (const segment of course.segments) {
    const ready = segment.prerequisites.every((id) => {
      const prerequisite = byId.get(id);
      // A prerequisite naming a segment that does not exist would silently lock the course forever.
      // Treating it as unmet is the safe reading, and the content test catches it before release.
      return prerequisite ? prerequisiteMet(prerequisite, progress) : false;
    });
    if (ready) open.add(segment.id);
  }

  return open;
}

export interface LockReason {
  locked: boolean;
  /** Human-readable, naming the segments that would open it. */
  because: string;
}

export function lockReason(
  course: LearningCourse,
  segment: LearningSegment,
  progress: CourseProgress,
): LockReason {
  const byId = new Map(course.segments.map((s) => [s.id, s]));
  const missing = segment.prerequisites
    .map((id) => byId.get(id))
    .filter((s): s is LearningSegment => s !== undefined)
    .filter((s) => !prerequisiteMet(s, progress));

  if (missing.length === 0) return { locked: false, because: "" };

  const names = missing.map((s) => `${s.order}. ${s.title}`);
  return {
    locked: true,
    because: `Finish the lessons and checkpoint for ${names.join(" and ")} first.`,
  };
}

/**
 * The final assessment is the one gate that needs the real cluster work: it is the thing the
 * certificate is mostly about, so every segment must be genuinely complete — capstone included.
 */
export function assessmentUnlocked(
  course: LearningCourse,
  progress: CourseProgress,
): boolean {
  return course.segments.every(
    (segment) =>
      prerequisiteMet(segment, progress) &&
      isComplete(progress, drillUnitId(segment.id, segment.capstoneDrillId)),
  );
}

export function assessmentLockReason(
  course: LearningCourse,
  progress: CourseProgress,
): string {
  const outstanding = course.segments.filter(
    (segment) =>
      !prerequisiteMet(segment, progress) ||
      !isComplete(progress, drillUnitId(segment.id, segment.capstoneDrillId)),
  );
  if (outstanding.length === 0) return "";
  return outstanding.length === 1
    ? `Complete ${outstanding[0].order}. ${outstanding[0].title} to unlock the final assessment.`
    : `${outstanding.length} segments remain before the final assessment unlocks.`;
}

/** Whether a capstone may be launched: its segment must be open and its lessons read. Starting a
 *  real cluster before the lesson that explains it is how a drill becomes button-guessing. */
export function capstoneUnlocked(
  segment: LearningSegment,
  progress: CourseProgress,
  segmentUnlocked: boolean,
): boolean {
  return (
    segmentUnlocked &&
    segment.lessons.every((l) => isComplete(progress, lessonUnitId(l.id)))
  );
}

/** True once every unit in the course, including the final assessment, is done. */
export function courseFinished(
  course: LearningCourse,
  progress: CourseProgress,
): boolean {
  return (
    assessmentUnlocked(course, progress) &&
    isComplete(progress, assessmentUnitId(course.finalAssessmentDrillId))
  );
}
