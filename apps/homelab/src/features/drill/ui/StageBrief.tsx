"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import type { LiveRunView } from "@/shared/api/live-client";
import { StageTrack } from "./StageTrack";
import styles from "../drill.module.css";

/**
 * A stage has just opened. On a cascade this is the handover note — what the fix that just worked
 * has caused. It gets its own screen because a cascade only teaches anything if the operator reads
 * why the next incident exists; buried above a list of buttons, it did not get read.
 */
export function StageBrief({
  run,
  onContinue,
}: {
  run: LiveRunView;
  onContinue: () => void;
}) {
  const openingDraw = run.drillMode === "ranked" && run.drillStage === 1;

  return (
    <div className={styles.brief}>
      <StageTrack run={run} />

      <p className={styles.briefEyebrow}>
        <AlertTriangle size={12} />{" "}
        {openingDraw ? "Scenario drawn" : "New incident"}
      </p>
      <h3>{run.drillStageTitle}</h3>

      <p className={styles.handoff}>
        {run.drillStageHandoff ||
          "The control plane has committed this live workload and started the official clock. Read the objective, then take command."}
      </p>

      <p className={styles.briefLabel}>Objective</p>
      <p className={styles.briefObjective}>
        {run.drillStageObjective || run.drillObjective}
      </p>

      <button className={styles.primary} onClick={onContinue}>
        {openingDraw ? "Enter match" : "Work the incident"}{" "}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
