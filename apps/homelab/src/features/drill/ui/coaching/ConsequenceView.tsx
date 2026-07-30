"use client";

import { ArrowRight, Check, Clock, TriangleAlert } from "lucide-react";
import type { DrillOption, LiveRunView } from "@/shared/api/live-client";
import { consequencesOf, type DecisionRecord } from "../../model/impact";
import type { HypothesisOption } from "../../model/coaching";
import styles from "../../coaching.module.css";

/**
 * What the last action actually did.
 *
 * Shown after every decision, right and wrong alike. A right action gets this because convergence
 * is confusing and a correct fix often makes things briefly worse; a wrong action gets it because
 * "that was wrong" teaches nothing next to "here is the number that did not move, and here is why".
 *
 * Practice always continues from here. The damage is real and it stays, which is the honest version
 * of the exercise — the next decision is taken on the cluster this one left behind.
 */
export function ConsequenceView({
  run,
  move,
  record,
  hypothesis,
  onContinue,
}: {
  run: LiveRunView;
  move: DrillOption | null;
  record: DecisionRecord | null;
  hypothesis: HypothesisOption | null;
  onContinue: () => void;
}) {
  const correct = move?.isCorrect === true;
  const measured = record ? consequencesOf(record.before, run) : [];

  return (
    <div className={styles.consequence} data-correct={correct}>
      <p className={styles.consequenceHead}>
        {correct ? (
          <Check size={14} aria-hidden />
        ) : (
          <TriangleAlert size={14} aria-hidden />
        )}
        {correct
          ? "Accepted — and it addressed the cause"
          : "Accepted — but it did not address the cause"}
      </p>

      {/* 1. What changed. The control plane took it either way, and saying so first separates
             "the platform rejected you" from "the platform did it and it did not help". */}
      {record && record.impact.length > 0 && (
        <div className={styles.deltaGrid}>
          {record.impact.map((i) => (
            <div key={`${i.tier}-${i.label}`} className={styles.delta}>
              <span>{i.label}</span>
              <span className={styles.deltaValue} data-worse={i.degrading}>
                <em>{i.from} → </em>
                {i.to}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 2. What the platform then measured. */}
      {measured.length > 0 && (
        <div className={styles.deltaGrid}>
          {measured.map((c) => (
            <div key={c.label} className={styles.delta}>
              <span>{c.label}</span>
              <span className={styles.deltaValue} data-worse={c.worse}>
                <em>{c.before} → </em>
                {c.now}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.reasoning}>
        {/* 3. Why, and which signal proves it. */}
        {move?.explanation && <p>{move.explanation}</p>}

        {!correct && hypothesis && (
          <p>
            <b>Against your hypothesis: </b>
            you predicted &ldquo;{hypothesis.predicts}&rdquo; That is the signal
            to check — if it has not moved, the tier you blamed is not the one
            that was constrained.
          </p>
        )}

        {!correct && (
          <p>
            <b>Recovering from here: </b>
            this change is still applied. Re-read the tiers before your next
            decision — the cluster you are now looking at is not the one you
            diagnosed, and undoing this may or may not be part of the fix.
          </p>
        )}

        <p className={styles.lagNote}>
          <Clock
            size={10}
            aria-hidden
            style={{ verticalAlign: -1, marginRight: 4 }}
          />
          Measured signals lag the state that produced them: throughput, latency
          and error rate are computed over a window that still contains the
          seconds before this change.
        </p>
      </div>

      <button type="button" className={styles.advance} onClick={onContinue}>
        Back to the cluster
        <ArrowRight size={13} aria-hidden />
      </button>
    </div>
  );
}
