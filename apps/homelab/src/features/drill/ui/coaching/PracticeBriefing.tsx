"use client";

import { ArrowRight, Siren } from "lucide-react";
import type { LiveRunView } from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import styles from "../../coaching.module.css";

/**
 * The incident, before the controls exist.
 *
 * It says what is happening to users, what the objective is, what changed, and which skills are
 * being assessed — and deliberately does not say what to do. The whole exercise is the diagnosis;
 * a briefing that names the fix is a briefing that has already done the work.
 */
export function PracticeBriefing({
  run,
  presentation,
  skills,
  onContinue,
}: {
  run: LiveRunView;
  presentation: "guided" | "assisted" | "assessment";
  skills: string[];
  onContinue: () => void;
}) {
  const impact =
    run.offeredRequestsPerSec > 0 && run.telemetry.requestsPerSec > 0
      ? `${Math.max(
          0,
          run.offeredRequestsPerSec - run.telemetry.requestsPerSec,
        )} requests a second are not being answered.`
      : "Users are reporting failures on the checkout path.";

  return (
    <div className={styles.briefing}>
      <p className={styles.briefingKicker}>
        <Siren size={11} aria-hidden />
        Incident briefing
      </p>
      <h2>{run.drillStageTitle || run.drillTitle}</h2>

      <p>{run.drillStageHandoff || run.drillObjective}</p>

      <div className={styles.briefFacts}>
        <div>
          <span>User impact</span>
          <b>{impact}</b>
        </div>
        <div>
          <span>Objective</span>
          <b>{run.drillStageObjective || run.drillObjective}</b>
        </div>
        <div>
          <span>Offered load</span>
          <b>
            {run.offeredRequestsPerSec > 0
              ? `${run.offeredRequestsPerSec}/s`
              : "none yet"}
          </b>
        </div>
        <div>
          <span>Latency target</span>
          <b>{run.telemetry.latencyTargetMs} ms at p95</b>
        </div>
        <div>
          <span>Reference time</span>
          <b>{clock(run.drillParSeconds * 1000)}</b>
        </div>
        <div>
          <span>Mode</span>
          <b>
            {presentation === "guided"
              ? "Guided"
              : presentation === "assisted"
                ? "Assisted"
                : "Assessment"}
          </b>
        </div>
      </div>

      {skills.length > 0 && (
        <div className={styles.skillTags}>
          {skills.map((skill) => (
            <span key={skill}>{skill}</span>
          ))}
        </div>
      )}

      <p className={styles.evidenceQuestion}>
        {presentation === "assessment"
          ? "No hints during this run. The cluster is the same real one, and a wrong action still continues the drill — the full explanation comes afterwards."
          : "A wrong action will not end this drill. It will really be applied to the cluster, and you will be shown what it measured — which is the point."}
      </p>

      <button type="button" className={styles.advance} onClick={onContinue}>
        Read the evidence
        <ArrowRight size={13} aria-hidden />
      </button>
    </div>
  );
}
