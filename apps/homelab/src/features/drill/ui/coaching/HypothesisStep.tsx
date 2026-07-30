"use client";

import { Crosshair } from "lucide-react";
import type { HypothesisOption } from "../../model/coaching";
import styles from "../../coaching.module.css";

/**
 * Name the fault before changing anything.
 *
 * A selection rather than free text, and never scored. Its job is to make the next few minutes
 * interpretable: once you have said which tier you blame and which signal should move, you can tell
 * a fix from a coincidence. A learner who acts without a hypothesis cannot — every outcome looks
 * like the outcome they were hoping for.
 *
 * A wrong hypothesis does not end the drill and does not restrict which actions are available. The
 * cluster does not care what you believe, and neither does this step.
 */
export function HypothesisStep({
  options,
  chosen,
  onChoose,
}: {
  options: HypothesisOption[];
  chosen: string | null;
  onChoose: (option: HypothesisOption) => void;
}) {
  return (
    <>
      <div className={styles.gateNote}>
        <Crosshair size={13} aria-hidden />
        <span>
          <b>Where is the fault, and what would prove it?</b> This is not scored
          and it does not restrict what you can do next — it is how you will
          know whether your fix worked.
        </span>
      </div>

      <div className={styles.hypotheses}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={styles.hypothesis}
            data-chosen={chosen === option.id}
            onClick={() => onChoose(option)}
            aria-pressed={chosen === option.id}
          >
            <b>{option.label}</b>
            <small>If you are right: {option.predicts}</small>
          </button>
        ))}
      </div>
    </>
  );
}
