"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import type { LiveRunView } from "@/shared/api/live-client";
import styles from "../drill.module.css";

/**
 * What the stage is actually waiting for, measured live. Showing the conditions rather than a
 * verdict means the objective can be worked towards deliberately — and it is honest about why the
 * stage has not ended yet.
 */
export function ObjectiveList({
  run,
  holding,
}: {
  run: LiveRunView;
  holding: boolean;
}) {
  const met = run.drillGoals.filter((g) => g.met).length;
  const progress = Math.min(
    100,
    (met / Math.max(1, run.drillGoals.length)) * 100,
  );

  return (
    <>
      <div className={styles.progress} title={`${met} of ${run.drillGoals.length} met`}>
        <i style={{ width: `${progress}%` }} />
      </div>

      <div className={styles.goals}>
        {run.drillGoals.map((g) => (
          <div
            key={g.label}
            className={`${styles.goal} ${g.met ? styles.goalMet : ""}`}
          >
            {g.met ? <Check size={12} /> : <Circle size={12} />}
            <span>{g.label}</span>
            <b>{g.current}</b>
            <em>{g.target}</em>
          </div>
        ))}
      </div>

      {holding && (
        <p className={styles.holding}>
          <Loader2 size={12} className={styles.spin} />
          Every condition is met — confirming it holds ({run.drillHeldSeconds}s
          of {run.drillHoldSeconds}s). Measured signals are noisy, so one good
          reading is not a recovery.
        </p>
      )}
    </>
  );
}
