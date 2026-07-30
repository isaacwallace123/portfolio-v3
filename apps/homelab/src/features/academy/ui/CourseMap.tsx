"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import type { LearningCourse } from "../model/course";
import type { CourseProgress, SegmentState } from "../model/progress";
import { SEGMENT_STATUS_LABELS } from "../model/progress";
import { lockReason } from "../model/unlocks";
import styles from "./academy.module.css";

// The seven segments as a connected path.
//
// Not a card grid. A grid says "here are seven equal things"; a path says "this is a course, you
// are here, and that is what comes next" — which is the question the dashboard exists to answer.
// The connecting line between the markers is what carries that, so it is drawn as far as the
// learner has actually got and no further.

export function CourseMap({
  course,
  states,
  progress,
  /** Compact mode drops the summaries — used beside the dashboard's continue card. */
  compact = false,
}: {
  course: LearningCourse;
  states: SegmentState[];
  progress: CourseProgress;
  compact?: boolean;
}) {
  return (
    <ol className={styles.path}>
      {course.segments.map((segment) => {
        const state = states.find((s) => s.segmentId === segment.id) ?? null;
        const status = state?.status ?? "locked";
        const locked = status === "locked";
        const reason = locked
          ? lockReason(course, segment, progress).because
          : "";
        const done = status === "complete" || status === "mastered";

        return (
          <li key={segment.id} className={styles.pathItem} data-state={status}>
            <span className={styles.marker} aria-hidden>
              {done ? <Check size={18} /> : segment.order}
            </span>

            <div className={styles.pathBody}>
              <div className={styles.pathHead}>
                <h3>
                  {locked ? (
                    <span>{segment.title}</span>
                  ) : (
                    <Link href={`/practice/segment/${segment.id}`}>
                      {segment.title}
                    </Link>
                  )}
                </h3>
                <span className={styles.statusTag} data-state={status}>
                  {SEGMENT_STATUS_LABELS[status]}
                </span>
              </div>

              {!compact && (
                <p className={styles.pathSummary}>{segment.summary}</p>
              )}

              {locked ? (
                <p className={styles.pathLocked}>
                  <Lock size={12} aria-hidden />
                  {reason}
                </p>
              ) : (
                state && (
                  <p className={styles.pathMeta}>
                    <span>
                      lessons{" "}
                      <b>
                        {state.lessonsComplete}/{state.lessonsTotal}
                      </b>
                    </span>
                    <span>
                      checkpoint{" "}
                      <b>
                        {state.checkpointScore !== null
                          ? `${state.checkpointScore}%`
                          : "—"}
                      </b>
                    </span>
                    <span>
                      capstone <b>{state.capstoneComplete ? "solved" : "—"}</b>
                      {state.capstoneClean && " · clean"}
                    </span>
                    {segment.masteryDrillId && (
                      <span>
                        mastery{" "}
                        <b>{state.masteryComplete ? "solved" : "optional"}</b>
                      </span>
                    )}
                  </p>
                )
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
