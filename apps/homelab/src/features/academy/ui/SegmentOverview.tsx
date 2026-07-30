"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  Award,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Loader2,
  Lock,
  Radio,
  Target,
  TriangleAlert,
} from "lucide-react";
import {
  checkpointUnitId,
  drillUnitId,
  lessonUnitId,
  segmentChecks,
  SKILL_LABELS,
  type LearningCourse,
  type LearningSegment,
} from "../model/course";
import { allAnswered, scoreChecks, type CheckAnswers } from "../model/checks";
import { isComplete, segmentState } from "../model/progress";
import { capstoneUnlocked } from "../model/unlocks";
import { useAcademyProgress } from "../model/useAcademyProgress";
import { KnowledgeCheckBlock } from "./KnowledgeCheck";
import styles from "./academy.module.css";

// A segment: what it teaches, its lessons, its checkpoint, and the real cluster drill that proves
// it. Deliberately one page rather than four — the learner should be able to see the whole shape of
// a segment, including the thing at the end of it, before spending an hour on the lessons.

export function SegmentOverview({
  course,
  segment,
}: {
  course: LearningCourse;
  segment: LearningSegment;
}) {
  const { progress, unlocked, loading, markComplete } =
    useAcademyProgress(course);
  const [answers, setAnswers] = useState<CheckAnswers>({});
  const [submitting, setSubmitting] = useState(false);

  const checks = useMemo(() => segmentChecks(segment), [segment]);
  const open = unlocked.has(segment.id);
  const state = segmentState(course, segment, progress, open);
  const capstoneOpen = capstoneUnlocked(segment, progress, open);

  // The checkpoint re-asks the segment's own checks. Nothing new: it is a chance to score the
  // reasoning after reading everything, not a surprise exam containing material nobody saw.
  const liveScore = scoreChecks(checks, answers);
  const ready = allAnswered(checks, answers);

  async function submitCheckpoint() {
    if (!ready || liveScore === null) return;
    setSubmitting(true);
    await markComplete(checkpointUnitId(segment.id), { score: liveScore });
    setSubmitting(false);
  }

  if (loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Loading…
        </p>
      </div>
    );

  return (
    <div className={styles.shell}>
      <header className={styles.lessonHead}>
        <p className={styles.crumbs}>
          <Link href="/practice">Academy</Link>
          <ChevronRight size={12} aria-hidden />
          <Link href="/practice/path/production-operations">
            {course.title}
          </Link>
          <ChevronRight size={12} aria-hidden />
          <span>Segment {segment.order}</span>
        </p>
        <h1>{segment.title}</h1>
        <p className={styles.lede}>{segment.summary}</p>
        <p className={styles.lessonMeta} style={{ marginTop: 18 }}>
          <span>{SKILL_LABELS[segment.domain]}</span>
          <span>
            {segment.lessons.length} lessons ·{" "}
            {segment.lessons.reduce((n, l) => n + l.estimatedMinutes, 0)} min
          </span>
          <span>{checks.length} knowledge checks</span>
          <span>capstone {segment.capstoneDrillId}</span>
        </p>
      </header>

      {!open && (
        <div
          className={styles.notice}
          data-tone="warn"
          style={{ marginTop: 26 }}
        >
          <Lock size={15} aria-hidden />
          <span>
            This segment is locked. Finish the lessons and checkpoint for the
            segments it builds on first.
          </span>
        </div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>What you will be able to do</h2>
        </div>
        <ul className={styles.outcomes}>
          {segment.outcomes.map((outcome) => (
            <li key={outcome}>
              <Target size={13} aria-hidden />
              <span>{outcome}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Lessons</h2>
          <p>
            {state.lessonsComplete} of {state.lessonsTotal} complete
          </p>
        </div>
        <div className={styles.unitList}>
          {segment.lessons.map((lesson) => {
            const done = isComplete(progress, lessonUnitId(lesson.id));
            return (
              <Link
                key={lesson.id}
                className={styles.unit}
                href={`/practice/lesson/${lesson.id}`}
                data-done={done}
              >
                <span className={styles.unitIcon}>
                  {done ? <Check size={15} /> : <BookOpen size={15} />}
                </span>
                <span className={styles.unitBody}>
                  <b>{lesson.title}</b>
                  <small>{lesson.summary}</small>
                </span>
                <span className={styles.unitAside}>
                  ~{lesson.estimatedMinutes} min
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Checkpoint ─────────────────────────────────────────────────── */}
      <section className={styles.section} id="checkpoint">
        <div className={styles.checkpoint}>
          <div className={styles.checkpointHead}>
            <h2>Checkpoint</h2>
            <p>
              {state.checkpointComplete
                ? "You have taken this checkpoint. Re-taking it can only improve your recorded score."
                : "The segment's own knowledge checks, together. Your first answer to each one is what scores — the explanations are the point, so read them either way."}
            </p>
          </div>

          {state.checkpointComplete && state.checkpointScore !== null && (
            <div
              className={styles.score}
              data-pass={state.checkpointScore >= 80}
            >
              <strong>{state.checkpointScore}%</strong>
              <span>
                recorded for this segment · the certificate needs 80% averaged
                across all seven
              </span>
            </div>
          )}

          {state.lessonsComplete < state.lessonsTotal ? (
            <p className={styles.notice} data-tone="info">
              <CircleDot size={15} aria-hidden />
              <span>
                Finish the {state.lessonsTotal - state.lessonsComplete}{" "}
                remaining{" "}
                {state.lessonsTotal - state.lessonsComplete === 1
                  ? "lesson"
                  : "lessons"}{" "}
                first. The checkpoint asks about all of them.
              </span>
            </p>
          ) : (
            <>
              {checks.map((check) => (
                <KnowledgeCheckBlock
                  key={check.id}
                  check={check}
                  chosen={answers[check.id] ?? null}
                  onChoose={(optionId) =>
                    setAnswers((prev) =>
                      // First answer wins, so a re-click after reading the explanation cannot
                      // quietly upgrade the score this attempt records.
                      prev[check.id] !== undefined
                        ? prev
                        : { ...prev, [check.id]: optionId },
                    )
                  }
                />
              ))}

              <div className={styles.actions} style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!ready || submitting}
                  onClick={submitCheckpoint}
                >
                  {submitting ? (
                    <Loader2 size={15} className="spin" aria-hidden />
                  ) : (
                    <Check size={15} aria-hidden />
                  )}
                  {ready
                    ? `Record ${liveScore}%`
                    : `Answer all ${checks.length} to record`}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Capstone ───────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Real-cluster capstone</h2>
          <p>
            A disposable Kubernetes namespace on the live homelab. Every number
            in it is measured, and the objective is judged by the platform.
          </p>
        </div>

        <div className={styles.unitList}>
          <CapstoneRow
            segment={segment}
            drillId={segment.capstoneDrillId}
            label="Capstone"
            done={isComplete(
              progress,
              drillUnitId(segment.id, segment.capstoneDrillId),
            )}
            clean={state.capstoneClean}
            open={capstoneOpen}
          />
          {segment.masteryDrillId && (
            <CapstoneRow
              segment={segment}
              drillId={segment.masteryDrillId}
              label="Mastery (optional)"
              done={state.masteryComplete}
              clean={false}
              open={capstoneOpen}
            />
          )}
          {segment.supportingDrillIds.map((drillId) => (
            <CapstoneRow
              key={drillId}
              segment={segment}
              drillId={drillId}
              label="Supporting practice"
              done={isComplete(progress, drillUnitId(segment.id, drillId))}
              clean={false}
              open={capstoneOpen}
            />
          ))}
        </div>

        {!capstoneOpen && (
          <p
            className={styles.notice}
            data-tone="warn"
            style={{ marginTop: 14 }}
          >
            <TriangleAlert size={15} aria-hidden />
            <span>
              Capstones unlock once this segment&apos;s lessons are done.
              Starting a real cluster before the lesson that explains it turns a
              drill into button-guessing.
            </span>
          </p>
        )}
      </section>

      <div className={styles.actions}>
        <Link className={styles.secondary} href="/practice">
          <ArrowRight
            size={14}
            aria-hidden
            style={{ transform: "rotate(180deg)" }}
          />
          Back to the Academy
        </Link>
        {state.status === "complete" || state.status === "mastered" ? (
          <Link className={styles.quiet} href="/practice/certificate">
            <Award size={13} aria-hidden />
            Certificate requirements
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function CapstoneRow({
  segment,
  drillId,
  label,
  done,
  clean,
  open,
}: {
  segment: LearningSegment;
  drillId: string;
  label: string;
  done: boolean;
  clean: boolean;
  open: boolean;
}) {
  const href = `/practice/drill/${drillId}?segment=${segment.id}`;
  const body = (
    <>
      <span className={styles.unitIcon}>
        {done ? (
          <Check size={15} />
        ) : open ? (
          <Radio size={15} />
        ) : (
          <Lock size={15} />
        )}
      </span>
      <span className={styles.unitBody}>
        <b>{drillId}</b>
        <small>
          {label}
          {done && clean && " · solved with no wrong action"}
          {done && !clean && " · solved"}
        </small>
      </span>
      <span className={styles.unitAside}>
        {open ? "Live cluster" : "Locked"}
      </span>
    </>
  );

  return open ? (
    <Link className={styles.unit} href={href as Route} data-done={done}>
      {body}
    </Link>
  ) : (
    <div className={styles.unit} data-done={done}>
      {body}
    </div>
  );
}
