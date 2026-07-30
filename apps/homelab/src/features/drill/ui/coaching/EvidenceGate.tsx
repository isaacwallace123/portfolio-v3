"use client";

import { ArrowRight, Check, Eye, Search } from "lucide-react";
import {
  evidenceRemaining,
  evidenceSatisfied,
  type EvidenceItem,
} from "../../model/coaching";
import styles from "../../coaching.module.css";

/**
 * The evidence gate.
 *
 * This replaces the old "decisions unlock in 10 seconds". A countdown teaches waiting; this teaches
 * that you read the instrument panel before you touch anything, and it is satisfied by looking at
 * signals rather than by the clock running.
 *
 * Every value shown is the cluster's own measurement, polled live. Inspecting an item highlights
 * the tier it describes on the graph, so "the gateway is at 94%" and the box that is drawing it are
 * the same thing rather than two facts to reconcile.
 */
export function EvidenceGate({
  evidence,
  inspected,
  guided,
  onInspect,
  onContinue,
}: {
  evidence: EvidenceItem[];
  inspected: Set<string>;
  /** Guided mode suggests where to start. Assisted and Assessment do not. */
  guided: boolean;
  onInspect: (item: EvidenceItem) => void;
  onContinue: () => void;
}) {
  const satisfied = evidenceSatisfied(inspected.size, evidence.length);
  const remaining = evidenceRemaining(inspected.size, evidence.length);

  return (
    <>
      <div className={styles.gateNote}>
        <Search size={13} aria-hidden />
        <span>
          {satisfied ? (
            <>
              <b>Evidence read.</b> The operator controls are unlocked.
            </>
          ) : (
            <>
              <b>
                Read {remaining} more {remaining === 1 ? "signal" : "signals"}.
              </b>{" "}
              The controls unlock when you have looked at the evidence — not
              after a countdown.
            </>
          )}
        </span>
      </div>

      {guided && !satisfied && (
        <p className={styles.evidenceQuestion}>
          Start with offered against served: it tells you whether a queue exists
          at all. Then read utilisation at each tier to find out where.
        </p>
      )}

      <div className={styles.evidenceList}>
        {evidence.map((item) => {
          const seen = inspected.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={styles.evidenceItem}
              data-seen={seen}
              onClick={() => onInspect(item)}
              aria-pressed={seen}
            >
              <span className={styles.evidenceHead}>
                <b>{item.label}</b>
                {seen ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <Eye size={12} aria-hidden />
                )}
              </span>
              <span className={styles.evidenceValue}>{item.value}</span>
              {/* The question is what makes this teaching rather than a readout: it says what the
                  number is FOR, which is the part a dashboard never tells you. */}
              {seen && (
                <span className={styles.evidenceQuestion}>{item.question}</span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.advance}
        disabled={!satisfied}
        onClick={onContinue}
      >
        {satisfied ? "Name the fault" : `${remaining} more to read`}
        {satisfied && <ArrowRight size={13} aria-hidden />}
      </button>
    </>
  );
}
