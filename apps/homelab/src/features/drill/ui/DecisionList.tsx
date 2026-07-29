"use client";

import { AlertTriangle, Check, Gauge, Loader2 } from "lucide-react";
import type { DrillOption, LiveRunView } from "@/shared/api/live-client";
import styles from "../drill.module.css";

/**
 * The moves available at this stage. Every one is really applied to the running workload, so the
 * copy says so — the stage ends when the objective is genuinely met, not when the right buttons
 * have been pressed.
 */
export function DecisionList({
  run,
  busy,
  disabled,
  onChoose,
}: {
  run: LiveRunView;
  busy: string | null;
  disabled: boolean;
  onChoose: (option: DrillOption) => void;
}) {
  return (
    <>
      <p className={styles.qHint}>
        Pick the actions you think resolve this. Every option is really applied
        to your cluster.
      </p>

      <div className={styles.decisions}>
        {run.drillOptions.map((o) => {
          const answered = o.chosen;
          const right = o.isCorrect === true;
          const pending = busy === `dec-${o.id}`;
          return (
            <button
              key={o.id}
              className={`${styles.decision} ${
                answered ? (right ? styles.qRight : styles.qWrong) : ""
              }`}
              onClick={() => onChoose(o)}
              disabled={!o.unlocked || answered || busy !== null || disabled}
            >
              <span className={styles.decisionIcon}>
                {pending || !o.unlocked ? (
                  <Loader2 size={14} className={styles.spin} />
                ) : answered ? (
                  right ? (
                    <Check size={14} />
                  ) : (
                    <AlertTriangle size={14} />
                  )
                ) : (
                  <Gauge size={14} />
                )}
              </span>
              <span>
                <b>{o.label}</b>
                <small>
                  {pending
                    ? "Applying to the cluster…"
                    : !o.unlocked
                      ? `Collecting a baseline from live traffic — unlocks in ${o.unlocksInSeconds}s`
                      : o.description}
                </small>
                {answered && o.explanation && (
                  <em className={right ? styles.whyOk : styles.whyBad}>
                    {o.explanation}
                  </em>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
