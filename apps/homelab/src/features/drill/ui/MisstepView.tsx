"use client";

import {
  ArrowRight,
  Gauge,
  Loader2,
  ShieldX,
  TrendingDown,
} from "lucide-react";
import {
  endDrill,
  type DrillOption,
  type LiveRunView,
} from "@/shared/api/live-client";
import { consequencesOf, type DecisionRecord } from "../model/impact";
import { clock } from "@/shared/lib/format";
import styles from "../drill.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/**
 * The moment a wrong move lands.
 *
 * The verdict is immediate and unambiguous, and the panel gives it the whole column — a tinted
 * button and a paragraph was easy to click past, which meant the explanation (the entire reason the
 * drill exists) went unread. The cluster graph stays fully visible beside this on purpose: the
 * option was really applied, so the damage is really happening, and the numbers below are what the
 * platform measured before and after it.
 */
export function MisstepView({
  run,
  move,
  record,
  ranked,
  busy,
  act,
  onAcknowledge,
}: {
  run: LiveRunView;
  move: DrillOption | null;
  record: DecisionRecord | null;
  /** Ranked attempts are one shot: this is the end of the run rather than a penalty. */
  ranked: boolean;
  busy: string | null;
  act: Act;
  onAcknowledge: () => void;
}) {
  const consequences = record ? consequencesOf(record.before, run) : [];

  return (
    <div className={`${styles.verdict} ${styles.verdictBad}`}>
      <span className={styles.verdictIcon}>
        <ShieldX size={26} />
      </span>
      <b>{ranked ? "Ranked attempt over" : "That made it worse"}</b>
      <p className={styles.verdictMove}>
        {move?.label ?? "An action that did not help"}
      </p>

      {move?.explanation && (
        <p className={styles.verdictWhy}>{move.explanation}</p>
      )}

      {/* What it actually did to the workload. The deltas are the spec the operator changed. */}
      {record && record.impact.length > 0 && (
        <div className={styles.impactList}>
          {record.impact.map((i) => (
            <div
              key={`${i.tier}-${i.label}`}
              className={i.degrading ? styles.impactBad : undefined}
            >
              <span>{i.label}</span>
              <b>
                {i.from} <ArrowRight size={10} /> {i.to}
              </b>
            </div>
          ))}
        </div>
      )}

      {/* And what the platform measured afterwards. Real degradation, not an animation. */}
      {consequences.length > 0 && (
        <>
          <p className={styles.verdictLabel}>
            <TrendingDown size={11} /> Measured since that action
          </p>
          <div className={styles.impactList}>
            {consequences.map((c) => (
              <div
                key={c.label}
                className={c.worse ? styles.impactBad : undefined}
              >
                <span>{c.label}</span>
                <b>
                  {c.before} <ArrowRight size={10} /> {c.now}
                </b>
              </div>
            ))}
          </div>
        </>
      )}

      {ranked ? (
        <>
          <p className={styles.verdictSub}>
            A ranked run is one shot, so no time is recorded for this attempt.
            The cluster is still yours and still carrying the damage — look at
            what it did before you tear it down.
          </p>
          <p className={styles.verdictSub}>
            {clock(run.elapsedMs)} elapsed · stage {run.drillStage} of{" "}
            {run.drillStageCount}
          </p>
          <button
            className={styles.primary}
            onClick={() => act("end", () => endDrill(run.runId))}
            disabled={busy !== null}
          >
            {busy === "end" ? (
              <Loader2 size={14} className={styles.spin} />
            ) : (
              <Gauge size={14} />
            )}
            Choose another drill
          </button>
        </>
      ) : (
        <>
          <p className={styles.verdictSub}>
            This is practice, so the drill continues — but the action really was
            applied, and the objective now has to be reached from where it left
            the cluster.
          </p>
          <button className={styles.primary} onClick={onAcknowledge}>
            Keep going
          </button>
        </>
      )}
    </div>
  );
}
