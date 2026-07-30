"use client";

import type { CoachingPhase } from "../../model/coaching";
import styles from "../../coaching.module.css";

// Where the learner is in the teaching flow.
//
// Shown because the flow is unusual and being made to look at evidence before the controls unlock
// is confusing if you cannot see that it is a step with an end. Three words and a bar, not a wizard.

const ORDER: { phase: CoachingPhase; label: string }[] = [
  { phase: "briefing", label: "Brief" },
  { phase: "observe", label: "Observe" },
  { phase: "hypothesise", label: "Diagnose" },
  { phase: "act", label: "Act" },
  { phase: "verify", label: "Verify" },
  { phase: "debrief", label: "Debrief" },
];

export function FlowSteps({ phase }: { phase: CoachingPhase }) {
  // Consequence is a detour off "act" rather than a step of its own — it happens between actions,
  // possibly several times, and drawing it as a stage would imply it comes after acting once.
  const effective: CoachingPhase = phase === "consequence" ? "act" : phase;
  const current = ORDER.findIndex((s) => s.phase === effective);

  return (
    <ol className={styles.steps} aria-label="Drill progress">
      {ORDER.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={step.phase}
            className={styles.step}
            data-state={state}
            // Without this a screen reader gets six words and no indication of which one you are
            // on, which is the only thing the strip is for.
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className={styles.stepBar} />
            <span className={styles.stepLabel}>
              {step.label}
              {state === "done" && (
                <span className={styles.srOnly}> (done)</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
