export { DrillPanel } from "./ui/DrillPanel";
export { useDrillState, type DrillPhase, type DrillState } from "./model/phase";
export type { TierImpact } from "./model/impact";

// The Academy's teaching flow over the same real drill engine. Practice only — nothing here is
// used by, or usable from, the ranked surface.
export { PracticeDrillPanel } from "./ui/PracticeDrillPanel";
export { useCoaching, type Coaching } from "./model/useCoaching";
export {
  buildDebrief,
  coachingPhase,
  decisionsUnlocked,
  evidenceFor,
  evidenceRemaining,
  evidenceSatisfied,
  hypothesesFor,
  tierUtilisation,
  EVIDENCE_FRACTION,
  type CoachingPhase,
  type CoachingRecord,
  type Debrief,
  type EvidenceItem,
  type HypothesisOption,
} from "./model/coaching";
