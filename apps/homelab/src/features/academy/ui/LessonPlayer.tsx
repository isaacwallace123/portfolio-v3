"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Eye,
  Radio,
} from "lucide-react";
import type {
  LearningBlock,
  LearningCourse,
  LearningLesson,
  LearningSegment,
} from "../model/course";
import { lessonUnitId } from "../model/course";
import type { CheckAnswers } from "../model/checks";
import { GuidedVisual, LessonVisual } from "../visuals";
import { KnowledgeCheckBlock, PredictionBlock } from "./KnowledgeCheck";
import styles from "./academy.module.css";

// The lesson engine.
//
// One switch over one block kind. Nothing in this file knows about the request path, canaries, or
// capacity — a new lesson is an entry in a content file, and a new *kind* of teaching is the only
// thing that brings anyone back here. That separation is the reason seven segments of material is
// maintainable at all.

export interface LessonPlayerProps {
  course: LearningCourse;
  segment: LearningSegment;
  lesson: LearningLesson;
  /** Previous and next inside the segment. Null at either end. */
  previous: LearningLesson | null;
  next: LearningLesson | null;
  completed: boolean;
  answers: CheckAnswers;
  onAnswer: (checkId: string, optionId: string) => void;
  onComplete: () => void;
}

export function LessonPlayer({
  course,
  segment,
  lesson,
  previous,
  next,
  completed,
  answers,
  onAnswer,
  onComplete,
}: LessonPlayerProps) {
  // Prediction answers are lesson-local: they are not scored, so they have nowhere to be stored
  // and nothing to be reconciled against.
  const [predictions, setPredictions] = useState<Record<string, string>>({});
  // Each guided control keeps its own dial position, keyed by block index so two controls in one
  // lesson do not share a value.
  const [dials, setDials] = useState<Record<number, number>>({});

  const checks = useMemo(
    () => lesson.blocks.flatMap((b) => (b.kind === "check" ? [b.check] : [])),
    [lesson],
  );
  const outstanding = checks.filter((c) => answers[c.id] === undefined).length;
  const index = segment.lessons.findIndex((l) => l.id === lesson.id);

  return (
    <div className={styles.shell}>
      <header className={styles.lessonHead}>
        <p className={styles.crumbs}>
          <Link href="/practice">Academy</Link>
          <ChevronRight size={12} aria-hidden />
          <Link href={`/practice/segment/${segment.id}`}>
            {segment.order}. {segment.title}
          </Link>
          <ChevronRight size={12} aria-hidden />
          <span>
            Lesson {index + 1} of {segment.lessons.length}
          </span>
        </p>
        <h1>{lesson.title}</h1>
        <p className={styles.lede}>{lesson.summary}</p>
        <p className={styles.lessonMeta} style={{ marginTop: 18 }}>
          <span>~{lesson.estimatedMinutes} min</span>
          <span>
            {checks.length} knowledge {checks.length === 1 ? "check" : "checks"}
          </span>
          <span>{course.title}</span>
          {completed && <span>completed</span>}
        </p>
      </header>

      <div className={styles.blocks}>
        {lesson.blocks.map((block, i) => (
          <Block
            key={`${lesson.id}-${i}`}
            block={block}
            answers={answers}
            onAnswer={onAnswer}
            predictions={predictions}
            onPredict={(id, option) =>
              setPredictions((prev) => ({ ...prev, [id]: option }))
            }
            dial={dials[i]}
            onDial={(v) => setDials((prev) => ({ ...prev, [i]: v }))}
          />
        ))}
      </div>

      <footer className={styles.lessonFoot}>
        <div className={styles.actions} style={{ marginTop: 0 }}>
          {previous ? (
            <Link
              className={styles.secondary}
              href={`/practice/lesson/${previous.id}`}
            >
              <ArrowLeft size={14} aria-hidden />
              Previous
            </Link>
          ) : (
            <Link
              className={styles.secondary}
              href={`/practice/segment/${segment.id}`}
            >
              <ArrowLeft size={14} aria-hidden />
              Segment
            </Link>
          )}

          {/* One primary action, and it is the one that records progress. Marking the lesson
              complete and moving on are the same click — a separate "mark complete" button is a
              thing people forget to press, and then their course is wrong. */}
          <button
            type="button"
            className={styles.primary}
            onClick={onComplete}
            disabled={outstanding > 0}
          >
            <Check size={15} aria-hidden />
            {completed
              ? next
                ? "Next lesson"
                : "Back to segment"
              : next
                ? "Complete and continue"
                : "Complete lesson"}
            <ArrowRight size={14} aria-hidden />
          </button>
        </div>

        <p className={styles.lessonFootNote}>
          {outstanding > 0
            ? `Answer ${outstanding} more knowledge ${
                outstanding === 1 ? "check" : "checks"
              } to complete this lesson. Your first answer is the one that scores.`
            : completed
              ? "Recorded. Segment progress is on the course map."
              : "All checks answered."}
        </p>
      </footer>
    </div>
  );
}

function Block({
  block,
  answers,
  onAnswer,
  predictions,
  onPredict,
  dial,
  onDial,
}: {
  block: LearningBlock;
  answers: CheckAnswers;
  onAnswer: (checkId: string, optionId: string) => void;
  predictions: Record<string, string>;
  onPredict: (predictionId: string, optionId: string) => void;
  dial: number | undefined;
  onDial: (value: number) => void;
}) {
  switch (block.kind) {
    case "context":
      return (
        <section className={styles.contextBlock}>
          <h3>{block.question}</h3>
          <p>{block.body}</p>
        </section>
      );

    case "model":
      return (
        <LessonVisual
          title={block.title}
          caption={block.caption}
          visual={block.visual}
        />
      );

    case "explanation":
      return (
        <section className={styles.explanation}>
          <h3>{block.title}</h3>
          <p>{block.idea}</p>
          <p className={styles.explanationExample}>{block.example}</p>
          <p className={styles.watchFor}>
            <Eye size={14} aria-hidden />
            <span>
              <b>Watch for: </b>
              {block.watchFor}
            </span>
          </p>
        </section>
      );

    case "metric-comparison":
      return (
        <figure className={styles.compare}>
          <figcaption>
            <h4>{block.title}</h4>
            {block.caption}
          </figcaption>
          <div className={styles.compareScroll}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Signal</th>
                  <th scope="col">{block.columns[0]}</th>
                  <th scope="col">{block.columns[1]}</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td data-worse={row.worse === 0 ? "true" : undefined}>
                      {row.left}
                    </td>
                    <td data-worse={row.worse === 1 ? "true" : undefined}>
                      {row.right}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      );

    case "trace-example": {
      const longest = Math.max(...block.spans.map((s) => s.durationMs), 1);
      return (
        <div className={styles.trace}>
          <div className={styles.traceHead}>
            <h4>{block.title}</h4>
            <p>{block.caption}</p>
          </div>
          {block.spans.map((span, i) => (
            <div
              key={`${span.name}-${i}`}
              className={styles.span}
              data-status={span.status}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className={styles.spanName}
                  style={{ paddingLeft: span.depth * 14 }}
                >
                  <i aria-hidden />
                  <span>{span.name}</span>
                  <em>{span.service}</em>
                </div>
                <div
                  className={styles.spanBar}
                  style={{
                    marginTop: 5,
                    marginLeft: span.depth * 14,
                    width: `${(span.durationMs / longest) * 100}%`,
                  }}
                />
              </div>
              <span className={styles.spanMs}>{span.durationMs} ms</span>
            </div>
          ))}
        </div>
      );
    }

    case "prediction":
      return (
        <PredictionBlock
          prediction={block.prediction}
          chosen={predictions[block.prediction.id] ?? null}
          onChoose={(optionId) => onPredict(block.prediction.id, optionId)}
        />
      );

    case "guided-control":
      return (
        <GuidedVisual
          title={block.title}
          caption={block.caption}
          visual={block.visual}
          control={block.control}
          observe={block.observe}
          value={dial ?? block.control.initial}
          onChange={onDial}
        />
      );

    case "check":
      return (
        <KnowledgeCheckBlock
          check={block.check}
          chosen={answers[block.check.id] ?? null}
          onChoose={(optionId) => onAnswer(block.check.id, optionId)}
        />
      );

    case "summary":
      return (
        <section className={styles.transfer}>
          <h3>What you can now do</h3>
          <ul>
            {block.canDo.map((item) => (
              <li key={item}>
                <Check size={14} aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {block.drillId && (
            <p>
              <Radio
                size={12}
                aria-hidden
                style={{ verticalAlign: -1, marginRight: 6 }}
              />
              You will prove this on a real cluster in <b>{block.drillId}</b>.
              {block.watchFor ? ` ${block.watchFor}` : ""}
            </p>
          )}
        </section>
      );
  }
}

export { lessonUnitId };
