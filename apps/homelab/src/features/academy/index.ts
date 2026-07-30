// HomeOps Academy — the public surface of the slice.
//
// Everything outside `features/academy` imports from here and nowhere deeper. Nothing in this
// slice is imported by Ranked, and nothing in this slice imports from Ranked; the two share the
// cluster engine and nothing else.

export {
  ACADEMY_COURSE,
  PRODUCTION_OPERATIONS,
} from "./content/production-operations";

export type {
  KnowledgeCheck,
  LearningBlock,
  LearningCourse,
  LearningLesson,
  LearningSegment,
  SkillDomain,
  UnitRef,
  UnitType,
  VisualId,
} from "./model/course";
export {
  assessmentUnitId,
  checkpointUnitId,
  courseUnits,
  drillTitle,
  DRILL_TITLES,
  drillUnitId,
  findLesson,
  findSegment,
  lessonUnitId,
  segmentChecks,
  segmentDrillIds,
  SKILL_LABELS,
} from "./model/course";

export type {
  CourseProgress,
  CourseState,
  Eligibility,
  IssuedCertificate,
  Requirement,
  SegmentState,
  SegmentStatus,
  SkillState,
  UnitProgress,
  UnitStatus,
} from "./model/progress";
export {
  CHECK_SCORE_REQUIRED,
  CLEAN_CAPSTONES_REQUIRED,
  courseState,
  demonstratedSkills,
  eligibility,
  emptyProgress,
  isComplete,
  isCurrentVersion,
  segmentState,
} from "./model/progress";

export {
  assessmentLockReason,
  assessmentUnlocked,
  capstoneUnlocked,
  courseFinished,
  lockReason,
  prerequisiteMet,
  unlockedSegments,
} from "./model/unlocks";

export {
  allAnswered,
  checkProblems,
  gradeCheck,
  scoreChecks,
  type CheckAnswers,
} from "./model/checks";

export { motionAllowed, useAnimationAllowed } from "./model/motion";
export { useAcademyProgress } from "./model/useAcademyProgress";

export { AcademyDashboard } from "./ui/AcademyDashboard";
export { AcademyCapstone } from "./ui/AcademyCapstone";
export { Certificate, CertificateView } from "./ui/CertificateView";
export { CertificateVerify } from "./ui/CertificateVerify";
export { CourseMap } from "./ui/CourseMap";
export { CoursePath } from "./ui/CoursePath";
export { LessonView } from "./ui/LessonView";
export { SegmentOverview } from "./ui/SegmentOverview";
export { SkillProfile } from "./ui/SkillProfile";
