"use client";

import { Gauge, Loader2, PartyPopper, ShieldCheck, Timer, Trophy } from "lucide-react";
import {
  endDrill,
  type DrillCatalogEntry,
  type LiveRunView,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import styles from "../drill.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/** Every stage cleared. The cluster survives the drill — only the objective ends. */
export function DrillResult({
  run,
  stat,
  busy,
  act,
}: {
  run: LiveRunView;
  stat: DrillCatalogEntry | undefined;
  busy: string | null;
  act: Act;
}) {
  // The incident really was resolved, so the drill really is over — an incident cannot be
  // un-resolved by how you got there. But getting there by applying an action that does not work is
  // not the same result, and celebrating it identically teaches that it is.
  const clean = run.drillWrongChosen === 0;
  const ranked = run.drillMode === "ranked";
  const parMs = run.drillParSeconds * 1000;
  const average = stat?.averageMs ?? 0;

  return (
    <div className={`${styles.verdict} ${clean ? styles.verdictGood : styles.verdictMessy}`}>
      <span className={styles.verdictIcon}>
        {clean ? <PartyPopper size={26} /> : <ShieldCheck size={26} />}
      </span>
      <b>{clean ? "Drill complete" : "Resolved, the hard way"}</b>
      <p className={styles.verdictMove}>
        {run.drillTitle}
        {ranked && <span className={styles.rankedTag}>Ranked</span>}
      </p>

      <div className={styles.scoreRow}>
        <div>
          <span>Correct</span>
          <b>
            {run.drillCorrectChosenAll}/{run.drillCorrectTotalAll}
          </b>
        </div>
        <div>
          <span>Missteps</span>
          <b className={run.drillWrongChosen ? styles.warnText : ""}>
            {run.drillWrongChosen}
          </b>
        </div>
        <div>
          <span>Time</span>
          <b>{clock(run.elapsedMs)}</b>
        </div>
      </div>

      {/* What the time is worth. A number with nothing to compare it against is not a result. */}
      <div className={styles.compareRow}>
        <span className={parMs > 0 && run.elapsedMs < parMs ? styles.okText : ""}>
          <Timer size={11} /> par {clock(parMs)}
        </span>
        {average > 0 && (
          <span className={run.elapsedMs < average ? styles.okText : ""}>
            <Gauge size={11} /> average {clock(average)}
          </span>
        )}
        {stat?.yourBestMs ? (
          <span>
            <Trophy size={11} /> your best {clock(stat.yourBestMs)}
          </span>
        ) : null}
      </div>

      {run.drillStageCount > 1 && (
        <p className={styles.verdictSub}>
          You worked {run.drillStageCount} consecutive incidents on this cluster,
          each one caused by the fix before it.
        </p>
      )}
      <p className={styles.verdictSub}>
        {clean
          ? "Straight to the actions that worked, with nothing wasted."
          : `You reached the objective, but ${
              run.drillWrongChosen === 1
                ? "one action along the way did not help"
                : `${run.drillWrongChosen} actions along the way did not help`
            } — and each was really applied to this cluster, so its effects are still there.`}
      </p>
      <p className={styles.verdictSub}>
        {ranked
          ? "Your time is on the board. The cluster is still yours — draw another ranked run, or keep experimenting with the controls."
          : "This time is recorded and counts towards the drill's average. The cluster is still yours."}
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
    </div>
  );
}
