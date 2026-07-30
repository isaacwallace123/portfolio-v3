"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Square } from "lucide-react";
import { endDrill, type LiveRunView } from "@/shared/api/live-client";
import type { DrillState } from "../model/phase";
import { useDrillCatalog } from "../model/useDrillCatalog";
import { DecisionList } from "./DecisionList";
import { DrillBrowser } from "./DrillBrowser";
import { DrillResult } from "./DrillResult";
import { MisstepView } from "./MisstepView";
import { ObjectiveList } from "./ObjectiveList";
import { StageBrief } from "./StageBrief";
import { StageTrack } from "./StageTrack";
import { clock } from "@/shared/lib/format";
import styles from "../drill.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/** What has already been applied this drill, and whether it helped. A cascade's later stages run on
 *  whatever the earlier ones left behind, so the damage stays on screen. */
function Ledger({ state }: { state: DrillState }) {
  if (state.history.length === 0) return null;
  return (
    <div className={styles.ledger}>
      <p className={styles.ledgerLabel}>Applied to this cluster</p>
      {state.history.map((h) => (
        <div
          key={`${h.optionId}-${h.at}`}
          className={h.correct ? styles.ledgerOk : styles.ledgerBad}
        >
          {h.correct ? <Check size={11} /> : <AlertTriangle size={11} />}
          <span>{h.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The drill surface. One switch over one derived phase — every screen the operator can be on is a
 * case here, rather than a combination of booleans each component re-derived for itself.
 */
export function DrillPanel({
  run,
  busy,
  provisioning,
  act,
  state,
}: {
  run: LiveRunView;
  busy: string | null;
  provisioning: boolean;
  act: Act;
  state: DrillState;
}) {
  const { phase } = state;
  // Refetched when a drill resolves, so the average this run just moved is the one shown next.
  const { drills, loading } = useDrillCatalog(run.drillSolved);
  const stat = drills.find((d) => d.id === run.drillId);
  const ranked = run.drillMode === "ranked";
  const [forfeitFor, setForfeitFor] = useState<string | null>(null);
  const confirmingForfeit = ranked && forfeitFor === run.drillId;

  switch (phase.kind) {
    case "browsing":
      return (
        <DrillBrowser
          run={run}
          busy={busy}
          provisioning={provisioning}
          drills={drills}
          loading={loading}
          act={act}
        />
      );

    case "solved":
      return (
        <div className={styles.scroll}>
          <DrillResult run={run} stat={stat} busy={busy} act={act} />
        </div>
      );

    case "failed":
      return (
        <div className={styles.scroll}>
          <MisstepView
            run={run}
            move={phase.move}
            record={phase.record}
            ranked
            busy={busy}
            act={act}
            onAcknowledge={state.acknowledge}
          />
        </div>
      );

    case "misstep":
      return (
        <div className={styles.scroll}>
          <MisstepView
            run={run}
            move={phase.move}
            record={phase.record}
            ranked={false}
            busy={busy}
            act={act}
            onAcknowledge={state.acknowledge}
          />
        </div>
      );

    case "briefing":
      return (
        <div className={styles.scroll}>
          <StageBrief run={run} onContinue={state.acknowledge} />
        </div>
      );

    default:
      return (
        <div className={styles.scroll}>
          <div className={styles.objective}>
            <b>
              {run.drillTitle}
              {ranked && <span className={styles.rankedTag}>Ranked</span>}
            </b>
            {run.drillStageTitle && (
              <p className={styles.stageName}>{run.drillStageTitle}</p>
            )}
            <p>{run.drillStageObjective || run.drillObjective}</p>
            <span>
              {clock(run.elapsedMs)} elapsed
              {run.offeredRequestsPerSec > 0 &&
                ` · ${run.offeredRequestsPerSec}/s offered`}
              {ranked && " · one wrong move ends this"}
            </span>
          </div>

          <StageTrack run={run} />

          <ObjectiveList run={run} holding={phase.kind === "holding"} />

          <DecisionList
            run={run}
            busy={busy}
            disabled={false}
            onChoose={state.onChoose}
          />

          <Ledger state={state} />

          {confirmingForfeit ? (
            <div className={styles.forfeitConfirm}>
              <p>
                <AlertTriangle size={12} />
                Leaving now records a loss and lowers your rating.
              </p>
              <div>
                <button
                  className={styles.ghost}
                  onClick={() => setForfeitFor(null)}
                  disabled={busy !== null}
                >
                  Stay in match
                </button>
                <button
                  className={styles.forfeit}
                  onClick={() => {
                    setForfeitFor(null);
                    act("end", () => endDrill(run.runId));
                  }}
                  disabled={busy !== null}
                >
                  {busy === "end" ? (
                    <Loader2 size={12} className={styles.spin} />
                  ) : (
                    <Square size={12} />
                  )}
                  Confirm forfeit
                </button>
              </div>
            </div>
          ) : (
            <button
              className={styles.ghost}
              onClick={() =>
                ranked
                  ? setForfeitFor(run.drillId)
                  : act("end", () => endDrill(run.runId))
              }
              disabled={busy !== null}
            >
              <Square size={12} />
              {ranked ? "Forfeit match" : "End drill, keep cluster"}
            </button>
          )}
        </div>
      );
  }
}
