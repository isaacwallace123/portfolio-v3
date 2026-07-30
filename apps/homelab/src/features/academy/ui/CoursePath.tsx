"use client";

import Link from "next/link";
import {
  ArrowRight,
  Award,
  ChevronRight,
  Loader2,
  Lock,
  Radio,
} from "lucide-react";
import type { LearningCourse } from "../model/course";
import { assessmentUnitId } from "../model/course";
import { isComplete } from "../model/progress";
import { assessmentLockReason, assessmentUnlocked } from "../model/unlocks";
import { useAcademyProgress } from "../model/useAcademyProgress";
import { CourseMap } from "./CourseMap";
import styles from "./academy.module.css";

/** The whole course on one page: every segment, its state, and the assessment that closes it. */
export function CoursePath({ course }: { course: LearningCourse }) {
  const { progress, state, loading } = useAcademyProgress(course);

  if (loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Loading the course…
        </p>
      </div>
    );

  const assessmentOpen = assessmentUnlocked(course, progress);
  const assessmentDone = isComplete(
    progress,
    assessmentUnitId(course.finalAssessmentDrillId),
  );
  const totalLessons = course.segments.reduce(
    (n, s) => n + s.lessons.length,
    0,
  );

  return (
    <div className={styles.shell}>
      <header className={styles.lessonHead}>
        <p className={styles.crumbs}>
          <Link href="/practice">Academy</Link>
          <ChevronRight size={12} aria-hidden />
          <span>Course outline</span>
        </p>
        <h1>{course.title}</h1>
        <p className={styles.lede}>{course.summary}</p>
        <p className={styles.lessonMeta} style={{ marginTop: 18 }}>
          <span>version {course.version}</span>
          <span>{course.segments.length} segments</span>
          <span>{totalLessons} lessons</span>
          <span>~{course.estimatedMinutes} min of reading</span>
          <span>{course.segments.length} real-cluster capstones</span>
        </p>
      </header>

      <section className={styles.section}>
        <CourseMap
          course={course}
          states={state.segments}
          progress={progress}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Final assessment</h2>
          <p>
            Not ranked. It may be retried, it never touches ELO, and it is
            judged the same way every capstone is.
          </p>
        </div>

        <div className={styles.continueCard}>
          <span>
            {assessmentDone
              ? "Completed"
              : assessmentOpen
                ? "Unlocked"
                : "Locked"}
          </span>
          <h2>{course.finalAssessmentTitle}</h2>
          <p>{course.finalAssessmentSummary}</p>

          <div className={styles.actions}>
            {assessmentOpen ? (
              <Link
                className={styles.primary}
                href={`/practice/drill/${course.finalAssessmentDrillId}?assessment=1`}
              >
                <Radio size={15} aria-hidden />
                {assessmentDone
                  ? "Retry the assessment"
                  : "Start the assessment"}
                <ArrowRight size={14} aria-hidden />
              </Link>
            ) : (
              <p
                className={styles.notice}
                data-tone="warn"
                style={{ margin: 0 }}
              >
                <Lock size={15} aria-hidden />
                <span>{assessmentLockReason(course, progress)}</span>
              </p>
            )}
          </div>
        </div>
      </section>

      <div className={styles.actions}>
        <Link className={styles.secondary} href="/practice/certificate">
          <Award size={14} aria-hidden />
          Certificate requirements
        </Link>
      </div>
    </div>
  );
}
