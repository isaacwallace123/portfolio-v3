"use client";

import { ShieldCheck } from "lucide-react";
import type { LiveRunView } from "@/shared/api/live-client";
import styles from "../../coaching.module.css";

/**
 * Why the drill has not ended yet, when every condition is green.
 *
 * The hold window is the part learners find arbitrary until it is explained, and it is the part
 * that makes the result mean anything: measured signals fluctuate, so a goal that resolved on one
 * good sample would resolve in the middle of an outage. This says that, and shows the window
 * counting.
 *
 * The evaluation itself stays where it was — server-side, from the platform's own measurements of
 * the namespace, on every poll. Nothing here decides anything.
 */
export function GoalVerification({ run }: { run: LiveRunView }) {
  const held = Math.min(run.drillHeldSeconds, run.drillHoldSeconds);
  const pct =
    run.drillHoldSeconds > 0 ? (held / run.drillHoldSeconds) * 100 : 0;

  return (
    <div className={styles.verify}>
      <p className={styles.verifyHead}>
        <ShieldCheck size={12} aria-hidden />
        Verifying recovery
      </p>

      <div
        className={styles.holdTrack}
        role="meter"
        aria-valuenow={held}
        aria-valuemin={0}
        aria-valuemax={run.drillHoldSeconds}
        aria-label="Verification window"
      >
        <div className={styles.holdFill} style={{ width: `${pct}%` }} />
      </div>

      <p>
        Every condition is currently satisfied, and has held for{" "}
        <b>
          {held}s of {run.drillHoldSeconds}s
        </b>
        . All of them must hold continuously — if one breaks for a single
        sample, this window restarts from zero rather than pausing.
      </p>
      <p>
        Recovery is an observed outcome, not a correct-button flag. The platform
        is reading your namespace, not your decisions.
      </p>
    </div>
  );
}
