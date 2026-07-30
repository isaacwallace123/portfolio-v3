import type { LearningCourse } from "../model/course";
import { readTheSystem } from "./segment-read-the-system";
import {
  capacityAndScaling,
  dataAndCaching,
  releasesAndRollouts,
} from "./segments-capacity-releases-data";
import {
  gatewaysAndFlow,
  progressiveDelivery,
  schedulingAndMovement,
} from "./segments-scheduling-gateways-delivery";

// The one certificate track.
//
// `version` is part of every stored progress row. Completing version 1 stays a historical fact if
// the lessons are rewritten later — the certificate names the version it was earned against, and
// progress from an older version is kept rather than silently re-counted against new requirements.
// Bump this only for a change that alters what the course claims to teach; fixing a typo does not.

export const PRODUCTION_OPERATIONS: LearningCourse = {
  id: "production-operations",
  version: 1,
  title: "Production Operations Foundations",
  summary:
    "Read a live system, work out which tier is actually constrained, and prove the fix on a real disposable Kubernetes cluster. Seven segments, each ending on a capstone drill against measured telemetry rather than a quiz.",
  estimatedMinutes: 180,

  segments: [
    readTheSystem,
    capacityAndScaling,
    releasesAndRollouts,
    dataAndCaching,
    schedulingAndMovement,
    gatewaysAndFlow,
    progressiveDelivery,
  ],

  // Multi-domain and deliberately not ranked: it may be retried, it never touches ELO, and it is
  // scored the same way every capstone is — by the platform, from the cluster it measured.
  finalAssessmentDrillId: "double-fault",
  finalAssessmentTitle: "Final assessment — two things are wrong",
  finalAssessmentSummary:
    "One cluster, more than one fault, and no indication of which order to take them in. Everything the seven segments taught, with nothing telling you which segment it belongs to.",
};

export const ACADEMY_COURSE = PRODUCTION_OPERATIONS;
