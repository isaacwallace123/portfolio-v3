"use client";

import { Loader2, Square } from "lucide-react";
import {
  endDrill,
  practiceCommand,
  practiceInspect,
  type LiveRunView,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import { OperatorConsole } from "@/widgets/operator-console";
import type { Coaching } from "../model/useCoaching";
import type { DrillState } from "../model/phase";
import { DecisionList } from "./DecisionList";
import { ObjectiveList } from "./ObjectiveList";
import { StageTrack } from "./StageTrack";
import { ConsequenceView } from "./coaching/ConsequenceView";
import { EvidenceGate } from "./coaching/EvidenceGate";
import { FlowSteps } from "./coaching/FlowSteps";
import { GoalVerification } from "./coaching/GoalVerification";
import { HypothesisStep } from "./coaching/HypothesisStep";
import { PracticeBriefing } from "./coaching/PracticeBriefing";
import { PracticeDebrief } from "./coaching/PracticeDebrief";
import coach from "../coaching.module.css";
import styles from "../drill.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

const PRACTICE_GREETING = [
  "Connected to your practice cluster. Nothing here is rated — being wrong is the point.",
  "Read the platform with inspect, then change it with an operator command. Type help for both lists.",
];

/**
 * The Academy's drill surface: briefing → observe → hypothesise → act → consequence → verify →
 * debrief.
 *
 * A separate component from `DrillPanel` rather than a mode inside it. The two flows genuinely
 * differ — a competitive attempt does not gate its controls on reading evidence, and a course does
 * not offer a forfeit that lowers a rating — and one component trying to be both is how a change
 * for the Academy ends up altering the ranked panel.
 *
 * What it does NOT change: the cluster is the same real one, every action is the same allowlisted
 * change applied by the API, and the objective is judged server-side from measured telemetry. This
 * file only decides what is on screen and when.
 */
export function PracticeDrillPanel({
  run,
  busy,
  act,
  state,
  coaching,
  presentation,
  skills,
  title,
  nextUp,
  onBackToCourse,
}: {
  run: LiveRunView;
  busy: string | null;
  act: Act;
  state: DrillState;
  coaching: Coaching;
  presentation: "guided" | "assisted" | "assessment";
  /** Skills the segment claims this drill assesses. Shown in the briefing. */
  skills: string[];
  title: string;
  nextUp: { label: string; href: string; why: string } | null;
  onBackToCourse: () => void;
}) {
  const { phase } = coaching;

  if (phase === "debrief" && coaching.debrief)
    return (
      <div className={coach.flow}>
        <PracticeDebrief
          debrief={coaching.debrief}
          title={title}
          nextUp={nextUp}
          onRetry={() => act("end", () => endDrill(run.runId))}
          onContinue={onBackToCourse}
        />
      </div>
    );

  if (phase === "briefing")
    return (
      <div className={coach.flow}>
        <FlowSteps phase={phase} />
        <PracticeBriefing
          run={run}
          presentation={presentation}
          skills={skills}
          onContinue={coaching.readBriefing}
        />
      </div>
    );

  if (phase === "observe")
    return (
      <div className={coach.flow}>
        <FlowSteps phase={phase} />
        <EvidenceGate
          evidence={coaching.evidence}
          inspected={coaching.inspected}
          guided={presentation === "guided"}
          onInspect={coaching.inspect}
          onContinue={coaching.finishObserving}
        />
      </div>
    );

  if (phase === "hypothesise")
    return (
      <div className={coach.flow}>
        <FlowSteps phase={phase} />
        <HypothesisStep
          options={coaching.hypotheses}
          selected={coaching.pendingHypothesis}
          onSelect={coaching.selectHypothesis}
          onConfirm={coaching.confirmHypothesis}
        />
      </div>
    );

  if (phase === "consequence") {
    const move =
      state.phase.kind === "misstep"
        ? state.phase.move
        : (run.drillOptions.find((o) => o.id === state.history[0]?.optionId) ??
          null);
    return (
      <div className={coach.flow}>
        <FlowSteps phase={phase} />
        <ConsequenceView
          run={run}
          move={move}
          record={state.history[0] ?? null}
          hypothesis={coaching.hypothesis}
          onContinue={coaching.readConsequence}
        />
      </div>
    );
  }

  // act | verify — the operator's console, with the objective it is being judged against.
  return (
    <div className={coach.flow}>
      <FlowSteps phase={phase} />

      <div className={styles.objective}>
        <b>{run.drillTitle}</b>
        {run.drillStageTitle && (
          <p className={styles.stageName}>{run.drillStageTitle}</p>
        )}
        <p>{run.drillStageObjective || run.drillObjective}</p>
        <span>
          {clock(run.elapsedMs)} elapsed
          {run.offeredRequestsPerSec > 0 &&
            ` · ${run.offeredRequestsPerSec}/s offered`}
        </span>
      </div>

      <StageTrack run={run} />

      <ObjectiveList run={run} holding={phase === "verify"} />

      {phase === "verify" && <GoalVerification run={run} />}

      {coaching.hypothesis && (
        <p className={coach.evidenceQuestion}>
          <b>Your hypothesis:</b> {coaching.hypothesis.label}. Watch for:{" "}
          {coaching.hypothesis.predicts}
        </p>
      )}

      {/* The same console a rated match is played through, on the same real cluster and the same
          allowlist. The course has to teach the interface it is preparing someone for; a curriculum
          whose only verb is "click the right button" prepares an operator for nothing.

          The suggested actions below it stay. They are the guided affordance — a way in for someone
          who has not learned the vocabulary yet — not a competing control plane: both ends produce
          the identical spec change against the identical cluster. */}
      <OperatorConsole
        busy={busy}
        greeting={PRACTICE_GREETING}
        onInspect={async (query) => {
          const evidence = await practiceInspect(run.runId, query);
          return evidence.lines;
        }}
        onCommand={(command) =>
          new Promise<void>((resolve, reject) => {
            act(`command:${command}`, () =>
              practiceCommand(run.runId, command).then(
                (next) => {
                  resolve();
                  return next;
                },
                (cause: unknown) => {
                  reject(cause);
                  throw cause;
                },
              ),
            );
          })
        }
      />

      <DecisionList
        run={run}
        busy={busy}
        disabled={!coaching.decisionsEnabled}
        onChoose={state.onChoose}
      />

      <button
        className={styles.ghost}
        onClick={() => act("end", () => endDrill(run.runId))}
        disabled={busy !== null}
      >
        {busy === "end" ? (
          <Loader2 size={12} className={styles.spin} />
        ) : (
          <Square size={12} />
        )}
        End drill, keep cluster
      </button>
    </div>
  );
}
