"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Lock, TriangleAlert } from "lucide-react";
import ClusterWorkbench from "@/widgets/cluster-workbench";
import type { LearningCourse, LearningSegment } from "../model/course";
import { assessmentUnitId, drillUnitId, SKILL_LABELS } from "../model/course";
import { ASSESSMENT_HREF, assessmentSkills } from "../model/assessment";
import {
  assessmentLockReason,
  assessmentUnlocked,
  capstoneUnlocked,
} from "../model/unlocks";
import { useAcademyProgress } from "../model/useAcademyProgress";
import styles from "./academy.module.css";

/**
 * What the debrief should send the learner to next.
 *
 * Chosen by the course rather than by the arena: after a capstone the useful next step is the
 * segment that follows, not another incident. The arena has no idea what a segment is, which is
 * why this is computed here and passed down as plain data.
 */
function nextUpFor(
  course: LearningCourse,
  segment: LearningSegment | null,
  assessment: boolean,
): { label: string; href: string; why: string } | undefined {
  if (assessment)
    return {
      label: "Certificate requirements",
      href: "/practice/certificate",
      why: "The final assessment is the last unit. Everything the certificate rests on is now recorded.",
    };
  if (!segment) return undefined;

  const next = course.segments.find((s) => s.order === segment.order + 1);
  if (next)
    return {
      label: `${next.order}. ${next.title}`,
      href: `/practice/segment/${next.id}`,
      why: next.summary,
    };

  return {
    label: course.finalAssessmentTitle,
    href: `/practice/path/${course.id}`,
    why: "Every segment is behind you. The assessment combines them with nothing telling you which is which.",
  };
}

export function AcademyCapstone({
  course,
  drillId,
  segment,
  assessment,
}: {
  course: LearningCourse;
  drillId: string;
  segment: LearningSegment | null;
  assessment: boolean;
}) {
  const academy = useAcademyProgress(course);

  if (academy.loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Checking the
          assignment…
        </p>
      </div>
    );

  const open = assessment
    ? assessmentUnlocked(course, academy.progress)
    : segment !== null &&
      capstoneUnlocked(
        segment,
        academy.progress,
        academy.unlocked.has(segment.id),
      );
  const unitId = assessment
    ? assessmentUnitId(drillId)
    : drillUnitId(segment?.id ?? "", drillId);
  const title = assessment
    ? course.finalAssessmentTitle
    : segment?.capstoneDrillId === drillId
      ? `${segment.title} capstone`
      : `${segment?.title ?? "Academy"} practice`;
  const description = assessment
    ? course.finalAssessmentSummary
    : `Apply what you learned in ${segment?.title ?? "this segment"} to a live incident. The platform resolves the objective from measured cluster telemetry.`;

  if (!open)
    return (
      <div className={styles.shell}>
        <header className={styles.lessonHead}>
          <p className={styles.eyebrow}>
            <Lock size={13} aria-hidden />
            Assignment locked
          </p>
          <h1>{title}</h1>
          <p className={styles.lede}>
            {assessment
              ? assessmentLockReason(course, academy.progress)
              : "Finish this segment’s lessons before opening its live-cluster work."}
          </p>
        </header>
        <div className={styles.actions}>
          <Link
            className={styles.secondary}
            href={
              assessment
                ? ASSESSMENT_HREF
                : `/practice/segment/${segment?.id ?? ""}`
            }
          >
            <ArrowLeft size={14} aria-hidden />
            {assessment ? "What the assessment needs" : "Return to coursework"}
          </Link>
        </div>
      </div>
    );

  return (
    <>
      {academy.error && (
        <div className={styles.notice} data-tone="warn">
          <TriangleAlert size={14} aria-hidden />
          <span>{academy.error}</span>
        </div>
      )}
      <ClusterWorkbench
        surface="practice"
        assignment={{
          drillId,
          learningUnitId: unitId,
          title,
          description,
          label: assessment ? "Final assessment" : "Academy field assignment",
          // Three presentations over one scenario. The final assessment withholds the guided
          // callouts because it is what the certificate rests on; it is still the same cluster,
          // a wrong action still continues, and the full explanation still arrives afterwards.
          presentation: assessment ? "assessment" : "guided",
          // A segment drill assesses one domain. The final assessment belongs to no segment and
          // draws on all seven — it used to pass an empty list, which read as "this assesses
          // nothing" on the one unit that assesses everything.
          skills: assessment
            ? assessmentSkills(course)
            : segment
              ? [SKILL_LABELS[segment.domain]]
              : [],
          returnHref: assessment
            ? ASSESSMENT_HREF
            : `/practice/segment/${segment?.id ?? ""}`,
          nextUp: nextUpFor(course, segment, assessment),
        }}
        onAssignmentResolved={academy.refresh}
      />
    </>
  );
}
