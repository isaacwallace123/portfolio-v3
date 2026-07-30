"use client";

import { ArrowRight, Crosshair } from "lucide-react";
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
  selected,
  onSelect,
  onConfirm,
}: {
  options: HypothesisOption[];
  /** The pick being considered. Local to this step until it is confirmed. */
  selected: HypothesisOption | null;
  onSelect: (option: HypothesisOption) => void;
  onConfirm: () => void;
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

      {/* Selecting and committing are two steps. Advancing on the first click would swap the panel
          out from under someone still comparing the options, and it would mean the choice they are
          about to operate on was never actually shown back to them. */}
      <div
        className={styles.hypotheses}
        role="radiogroup"
        aria-label="Where is the fault?"
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            className={styles.hypothesis}
            data-chosen={selected?.id === option.id}
            onClick={() => onSelect(option)}
            aria-checked={selected?.id === option.id}
          >
            <b>{option.label}</b>
            <small>If you are right: {option.predicts}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.advance}
        disabled={selected === null}
        onClick={onConfirm}
      >
        {selected === null ? "Choose a hypothesis" : "Open the controls"}
        {selected !== null && <ArrowRight size={13} aria-hidden />}
      </button>
    </>
  );
}
