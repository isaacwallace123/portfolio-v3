"use client";

import { CircleHelp, Lightbulb, Sparkles } from "lucide-react";
import type { KnowledgeCheck as Check, Prediction } from "../model/course";
import styles from "./academy.module.css";

// The two things the course asks a learner to do before it tells them anything.
//
// Both render as a list of buttons and they are deliberately not the same component. A prediction
// is never wrong — it exists so the demonstration that follows means something — and a check is
// scored. Sharing one component would have meant one of the two picking up the other's manners.

const KEYS = "ABCD";

/**
 * A prediction. Every option stays readable after answering, the one the system actually does is
 * marked, and the explanation is about the system rather than about the guess.
 *
 * There is no "correct" styling here on purpose. Marking a prediction wrong teaches people to stop
 * predicting honestly, and an honest prediction is the entire mechanism — it is what turns the next
 * animation from a thing you watched into a thing you were wrong about.
 */
export function PredictionBlock({
  prediction,
  chosen,
  onChoose,
}: {
  prediction: Prediction;
  chosen: string | null;
  onChoose: (optionId: string) => void;
}) {
  const answered = chosen !== null;

  return (
    <section className={styles.ask} aria-labelledby={`${prediction.id}-prompt`}>
      <p className={styles.askKind}>
        <CircleHelp size={11} aria-hidden />
        Predict first
      </p>
      <h3 id={`${prediction.id}-prompt`}>{prediction.prompt}</h3>

      <div className={styles.choices} role="group">
        {prediction.options.map((option, i) => {
          const isActual = option.id === prediction.actualOptionId;
          return (
            <button
              key={option.id}
              type="button"
              className={styles.choice}
              disabled={answered}
              onClick={() => onChoose(option.id)}
              data-verdict={answered && isActual ? "actual" : undefined}
              data-dimmed={
                answered && !isActual && option.id !== chosen
                  ? "true"
                  : undefined
              }
              aria-pressed={chosen === option.id}
            >
              <span className={styles.choiceKey}>{KEYS[i]}</span>
              <span>
                {option.label}
                {answered && isActual && " — this is what happens"}
              </span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div className={styles.why} role="status">
          <p>{prediction.because}</p>
        </div>
      )}
    </section>
  );
}

/**
 * A knowledge check.
 *
 * The first answer is the one that scores, and the learner is told so before they start. Retrying
 * after reading the explanation is encouraged — that is what the explanation is for — but a score
 * that rewards clicking until something turns green measures persistence, not reasoning.
 *
 * Every option explains itself once answered, including the ones nobody picked. The wrong options
 * are where most of the teaching is: each one is a real diagnosis somebody would plausibly reach.
 */
export function KnowledgeCheckBlock({
  check,
  chosen,
  onChoose,
}: {
  check: Check;
  chosen: string | null;
  onChoose: (optionId: string) => void;
}) {
  const answered = chosen !== null;
  const chosenOption = check.options.find((o) => o.id === chosen) ?? null;

  return (
    <section className={styles.ask} aria-labelledby={`${check.id}-prompt`}>
      <p className={styles.askKind}>
        <Lightbulb size={11} aria-hidden />
        Knowledge check
      </p>
      <h3 id={`${check.id}-prompt`}>{check.prompt}</h3>

      {check.evidence && check.evidence.length > 0 && (
        <div className={styles.evidence}>
          {check.evidence.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      )}

      <div className={styles.choices} role="group">
        {check.options.map((option, i) => (
          <button
            key={option.id}
            type="button"
            className={styles.choice}
            disabled={answered}
            onClick={() => onChoose(option.id)}
            data-verdict={
              !answered
                ? undefined
                : option.correct
                  ? "correct"
                  : option.id === chosen
                    ? "wrong"
                    : undefined
            }
            data-dimmed={
              answered && !option.correct && option.id !== chosen
                ? "true"
                : undefined
            }
            aria-pressed={chosen === option.id}
          >
            <span className={styles.choiceKey}>{KEYS[i]}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>

      {answered && chosenOption && (
        <div
          className={styles.why}
          data-tone={chosenOption.correct ? "correct" : "wrong"}
          role="status"
        >
          <p>
            <b>{chosenOption.correct ? "Correct. " : "Not this one. "}</b>
            {chosenOption.why}
          </p>

          {/* The option nobody picked that was right is the one worth reading next. Shown only
              when the learner got it wrong, so a correct answer is not followed by a lecture. */}
          {!chosenOption.correct &&
            check.options
              .filter((o) => o.correct)
              .map((o) => (
                <p key={o.id}>
                  <b>{o.label}: </b>
                  {o.why}
                </p>
              ))}

          <p className={styles.takeaway}>
            <Sparkles size={13} aria-hidden />
            <span>{check.takeaway}</span>
          </p>
        </div>
      )}
    </section>
  );
}
