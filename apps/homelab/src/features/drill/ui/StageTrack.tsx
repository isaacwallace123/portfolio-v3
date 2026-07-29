"use client";

import type { LiveRunView } from "@/shared/api/live-client";
import styles from "../drill.module.css";

/** Where the cascade has got to. One pip per stage, so the shape of the drill is visible up front. */
export function StageTrack({ run }: { run: LiveRunView }) {
  if (run.drillStageCount <= 1) return null;
  return (
    <div
      className={styles.stageTrack}
      title={`Stage ${run.drillStage} of ${run.drillStageCount}`}
    >
      {Array.from({ length: run.drillStageCount }, (_, i) => (
        <i
          key={i}
          className={
            i + 1 < run.drillStage
              ? styles.stageDone
              : i + 1 === run.drillStage
                ? styles.stageNow
                : undefined
          }
        />
      ))}
      <span>
        Stage {run.drillStage} of {run.drillStageCount}
      </span>
    </div>
  );
}
