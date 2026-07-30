"use client";

import {
  ArrowRight,
  Check,
  Crosshair,
  GraduationCap,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { clock } from "@/shared/lib/format";
import type { Debrief } from "../../model/coaching";
import styles from "../../coaching.module.css";

/**
 * The educational result screen.
 *
 * Not "correct / incorrect". It reconstructs the incident as the learner worked it — what they
 * said was wrong, what they did, what the platform measured in response — and then states the
 * causal chain in a sentence. Time is present but it is one line among several, because a fast
 * solve arrived at by guessing is not the result this course is trying to produce.
 */
export function PracticeDebrief({
  debrief,
  title,
  nextUp,
  onRetry,
  onContinue,
}: {
  debrief: Debrief;
  title: string;
  /** Where to go next, chosen by the course rather than by the arena. */
  nextUp: { label: string; href: string; why: string } | null;
  onRetry: () => void;
  onContinue: () => void;
}) {
  return (
    <div className={styles.debrief}>
      <div className={styles.debriefHead}>
        <span>{debrief.solved ? "Objective reached" : "Drill ended"}</span>
        <h2>{title}</h2>
        <p>
          {clock(debrief.elapsedMs)} elapsed ·{" "}
          {debrief.clean
            ? "no wrong operational actions"
            : `${debrief.unnecessary.length} action${
                debrief.unnecessary.length === 1 ? "" : "s"
              } that did not address the cause`}
        </p>
      </div>

      {/* The causal chain, in the platform's own numbers. */}
      {debrief.causalChain && (
        <p className={styles.causal}>{debrief.causalChain}</p>
      )}

      {/* Before and after, so "it worked" is a measurement. */}
      {debrief.before && (
        <div className={styles.beforeAfter}>
          <div className={styles.beforeAfterHead}>
            <span>Signal</span>
            <span>At diagnosis</span>
            <span>Now</span>
          </div>
          <Row
            label="Served / offered"
            before={`${debrief.before.served}/${debrief.before.offered}`}
            after={`${debrief.after.served}/${debrief.after.offered}`}
          />
          <Row
            label="p95 latency"
            before={`${Math.round(debrief.before.p95)} ms`}
            after={`${Math.round(debrief.after.p95)} ms`}
          />
          <Row
            label="Error rate"
            before={`${debrief.before.errors.toFixed(2)}%`}
            after={`${debrief.after.errors.toFixed(2)}%`}
          />
        </div>
      )}

      {/* The timeline: hypothesis first, then every action in the order it was taken. */}
      {debrief.timeline.length > 0 && (
        <div className={styles.timeline}>
          {debrief.timeline.map((step, i) => (
            <div
              key={`${step.kind}-${i}`}
              className={styles.timelineItem}
              data-kind={step.kind}
              data-correct={
                step.correct === undefined ? undefined : step.correct
              }
            >
              <span className={styles.timelineDot} aria-hidden>
                {step.kind === "hypothesis" ? (
                  <Crosshair size={10} />
                ) : step.correct ? (
                  <Check size={11} />
                ) : (
                  <TriangleAlert size={10} />
                )}
              </span>
              <div className={styles.timelineBody}>
                <b>{step.label}</b>
                <small>{step.detail}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className={styles.lesson}>
        <Sparkles size={13} aria-hidden />
        <span>{debrief.keyLesson}</span>
      </p>

      {nextUp && (
        <div className={styles.nextUp}>
          <span>Recommended next</span>
          <a href={nextUp.href}>
            {nextUp.label} <ArrowRight size={11} aria-hidden />
          </a>
          <p>{nextUp.why}</p>
        </div>
      )}

      <button type="button" className={styles.advance} onClick={onContinue}>
        <GraduationCap size={14} aria-hidden />
        Back to the course
      </button>
      <button type="button" className={styles.ghostWide} onClick={onRetry}>
        <RotateCcw size={12} aria-hidden />
        Run it again on this cluster
      </button>
    </div>
  );
}

function Row({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <div className={styles.beforeAfterRow}>
      <span>{label}</span>
      <b>{before}</b>
      <b>{after}</b>
    </div>
  );
}
