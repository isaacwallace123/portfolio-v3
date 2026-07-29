"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Gauge,
  Loader2,
  PartyPopper,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  endDrill,
  liveDecision,
  startDrill,
  type DrillGoal,
  type LiveRunView,
} from "@/shared/api/live-client";
import { homelabScenarios } from "@/entities/scenario";
import { clock } from "../lib/format";
import styles from "../workbench.module.css";

const SANDBOX = "practice-cluster";
const DRILLS = homelabScenarios.filter((s) => s.id !== SANDBOX);

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/** No drill running: pick one to layer over the cluster that is already up. */
function DrillPicker({
  run,
  busy,
  provisioning,
  act,
}: {
  run: LiveRunView;
  busy: string | null;
  provisioning: boolean;
  act: Act;
}) {
  return (
    <>
      <p className={styles.hint}>
        A drill sets an objective and a clock on this cluster and unlocks its
        operator decisions. Nothing is reprovisioned — the workload stays up.
      </p>
      <div className={styles.drills}>
        {DRILLS.map((d, i) => (
          <button
            key={d.id}
            className={styles.drillItem}
            onClick={() =>
              act(`drill-${d.id}`, () => startDrill(run.runId, d.id))
            }
            disabled={busy !== null || provisioning}
          >
            <span className={styles.drillNo}>
              {busy === `drill-${d.id}` ? (
                <Loader2 size={12} className={styles.spin} />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <span>
              <b>{d.title}</b>
              <small>{d.summary}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      {provisioning && (
        <p className={styles.hint}>
          Drills unlock once the workload is serving traffic.
        </p>
      )}
    </>
  );
}

/** Every correct action found. The cluster survives the drill — only the objective ends. */
function DrillSolved({
  run,
  title,
  busy,
  act,
}: {
  run: LiveRunView;
  title: string;
  busy: string | null;
  act: Act;
}) {
  // The incident really was resolved, so the drill really is over — an incident cannot be
  // un-resolved by how you got there. But getting there by applying an action that does not work is
  // not the same result, and celebrating it identically teaches that it is. A clean resolution is
  // congratulated; one carrying missteps is acknowledged, and says what they cost.
  const clean = run.drillWrongChosen === 0;

  return (
    <div className={`${styles.solved} ${clean ? "" : styles.solvedMessy}`}>
      <span className={styles.solvedIcon}>
        {clean ? <PartyPopper size={22} /> : <ShieldCheck size={22} />}
      </span>
      <b>{clean ? "Drill complete" : "Resolved, the hard way"}</b>
      <p className={styles.solvedName}>{title}</p>
      <div className={styles.scoreRow}>
        <div>
          <span>Correct</span>
          <b>
            {run.drillCorrectChosen}/{run.drillCorrectTotal}
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
      <p className={styles.solvedSub}>
        {clean
          ? "Straight to the actions that worked, with nothing wasted."
          : `You reached the objective, but ${
              run.drillWrongChosen === 1
                ? "one action along the way did not help"
                : `${run.drillWrongChosen} actions along the way did not help`
            } — and each was really applied to this cluster, so its effects are still there.`}
      </p>
      <p className={styles.solvedSub}>
        The cluster is still yours — run another drill on it, or keep
        experimenting with the controls.
      </p>
      <button
        className={styles.primarySm}
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

/**
 * What the drill is actually waiting for, measured live. Showing the conditions rather than a
 * verdict means the objective can be worked towards deliberately — and it is honest about why the
 * drill has not ended yet.
 */
function GoalList({ goals }: { goals: DrillGoal[] }) {
  if (goals.length === 0) return null;
  return (
    <div className={styles.goals}>
      {goals.map((g) => (
        <div
          key={g.label}
          className={`${styles.goal} ${g.met ? styles.goalMet : ""}`}
        >
          {g.met ? <Check size={12} /> : <Circle size={12} />}
          <span>{g.label}</span>
          <b>{g.current}</b>
          <em>{g.target}</em>
        </div>
      ))}
    </div>
  );
}

/** A drill in progress: the objective, and the decisions that are really applied to the cluster. */
function DrillInProgress({
  run,
  title,
  objective,
  busy,
  act,
}: {
  run: LiveRunView;
  title: string;
  objective: string;
  busy: string | null;
  act: Act;
}) {
  const met = run.drillGoals.filter((g) => g.met).length;
  const allMet = run.drillGoals.length > 0 && met === run.drillGoals.length;
  const progress = Math.min(
    100,
    (met / Math.max(1, run.drillGoals.length)) * 100,
  );

  return (
    <>
      <div className={styles.objective}>
        <b>{title}</b>
        <p>{objective}</p>
        <span>
          {met} of {run.drillGoals.length} conditions met ·{" "}
          {clock(run.elapsedMs)} elapsed
        </span>
      </div>
      <div
        className={styles.progress}
        title={`${met} of ${run.drillGoals.length} objective conditions met`}
      >
        <i style={{ width: `${progress}%` }} />
      </div>

      <GoalList goals={run.drillGoals} />

      {allMet && run.drillHoldSeconds > 0 && (
        <p className={styles.holding}>
          <Loader2 size={12} className={styles.spin} />
          Every condition is met — confirming it holds ({run.drillHeldSeconds}s
          of {run.drillHoldSeconds}s). Measured signals are noisy, so one good
          reading is not a recovery.
        </p>
      )}

      <p className={styles.qHint}>
        Pick the actions you think resolve this. Every option is really applied
        to your cluster — the drill ends when the objective above is actually
        met, not when the right buttons have been pressed.
      </p>

      <div className={styles.decisions}>
        {run.drillOptions.map((o) => {
          const answered = o.chosen;
          const right = o.isCorrect === true;
          const pending = busy === `dec-${o.id}`;
          return (
            <div key={o.id} className={styles.qWrap}>
              <button
                className={`${styles.decision} ${
                  answered ? (right ? styles.qRight : styles.qWrong) : ""
                } ${pending ? styles.pending : ""}`}
                onClick={() =>
                  act(`dec-${o.id}`, () => liveDecision(run.runId, o.id))
                }
                disabled={!o.unlocked || answered || busy !== null}
              >
                {pending || !o.unlocked ? (
                  <Loader2 size={14} className={styles.spin} />
                ) : answered ? (
                  right ? (
                    <Check size={14} />
                  ) : (
                    <AlertTriangle size={14} />
                  )
                ) : (
                  <Gauge size={14} />
                )}
                <span>
                  <b>{o.label}</b>
                  <small>
                    {pending
                      ? "Applying to the cluster…"
                      : !o.unlocked
                        ? `Collecting a baseline from live traffic — unlocks in ${o.unlocksInSeconds}s`
                        : o.description}
                  </small>
                </span>
              </button>
              {answered && o.explanation && (
                <p
                  className={`${styles.qWhy} ${right ? styles.qWhyOk : styles.qWhyBad}`}
                >
                  {o.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

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
    </>
  );
}

export function DrillsPanel({
  run,
  busy,
  provisioning,
  act,
}: {
  run: LiveRunView;
  busy: string | null;
  provisioning: boolean;
  act: Act;
}) {
  const drill = run.drillId ? DRILLS.find((d) => d.id === run.drillId) : null;
  if (!drill)
    return (
      <DrillPicker
        run={run}
        busy={busy}
        provisioning={provisioning}
        act={act}
      />
    );

  const title = run.drillTitle || drill.title;
  if (run.drillSolved)
    return <DrillSolved run={run} title={title} busy={busy} act={act} />;

  return (
    <DrillInProgress
      run={run}
      title={title}
      objective={run.drillObjective || drill.summary}
      busy={busy}
      act={act}
    />
  );
}
