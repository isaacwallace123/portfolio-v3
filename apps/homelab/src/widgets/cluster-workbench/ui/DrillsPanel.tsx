"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Gauge,
  Layers,
  Loader2,
  PartyPopper,
  ShieldCheck,
  Square,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";
import {
  endDrill,
  fetchDrills,
  liveDecision,
  startDrill,
  type DrillCatalogEntry,
  type DrillGoal,
  type LiveRunView,
} from "@/shared/api/live-client";
import { clock } from "../lib/format";
import styles from "../workbench.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/** A recorded time, or an em dash when nobody has set one yet. */
function time(ms: number | null | undefined) {
  return ms && ms > 0 ? clock(ms) : "—";
}

/** One row of the picker: what the drill is, and what it has cost people. */
function DrillRow({
  drill,
  busy,
  disabled,
  onStart,
}: {
  drill: DrillCatalogEntry;
  busy: string | null;
  disabled: boolean;
  onStart: () => void;
}) {
  const key = `drill-${drill.id}`;
  return (
    <button
      className={styles.drillItem}
      onClick={onStart}
      disabled={disabled}
      title={drill.objective}
    >
      <span className={styles.drillNo}>
        {busy === key ? (
          <Loader2 size={12} className={styles.spin} />
        ) : drill.stageCount > 1 ? (
          <Layers size={12} />
        ) : (
          <Zap size={12} />
        )}
      </span>
      <span>
        <b>{drill.title}</b>
        <small>{drill.summary}</small>
        <span className={styles.drillMeta}>
          {drill.stageCount > 1 && <em>{drill.stageCount} stages</em>}
          <em>par {clock(drill.parSeconds * 1000)}</em>
          {/* Averaged over every recorded attempt by everyone, which is the only reason it is
              worth showing next to your own. */}
          <em>avg {time(drill.averageMs)}</em>
          {drill.yourBestMs ? (
            <em className={styles.drillMine}>your best {time(drill.yourBestMs)}</em>
          ) : (
            <em>{drill.attempts === 0 ? "unsolved" : `${drill.attempts} solves`}</em>
          )}
        </span>
      </span>
      <ChevronRight size={14} />
    </button>
  );
}

/** No drill running: pick one to layer over the cluster that is already up, or draw a ranked one. */
function DrillPicker({
  run,
  busy,
  provisioning,
  catalog,
  loading,
  act,
}: {
  run: LiveRunView;
  busy: string | null;
  provisioning: boolean;
  catalog: DrillCatalogEntry[];
  loading: boolean;
  act: Act;
}) {
  const cascades = catalog.filter((d) => d.stageCount > 1);
  const singles = catalog.filter((d) => d.stageCount <= 1);
  const locked = busy !== null || provisioning;

  return (
    <>
      <p className={styles.hint}>
        A drill sets an objective and a clock on this cluster and unlocks its
        operator decisions. Nothing is reprovisioned — the workload stays up, and
        every time you record counts towards the drill&apos;s average.
      </p>

      {/* Ranked is the drawn run: you do not get to pick the cascade you are timed on. */}
      <button
        className={styles.rankedCard}
        onClick={() => act("ranked", () => startDrill(run.runId, "", "ranked"))}
        disabled={locked || cascades.length === 0}
      >
        <span className={styles.rankedIcon}>
          {busy === "ranked" ? (
            <Loader2 size={18} className={styles.spin} />
          ) : (
            <Trophy size={18} />
          )}
        </span>
        <span>
          <b>Start a ranked run</b>
          <small>
            One multi-stage cascade, drawn at random and timed from the first
            signal to the last recovery. Your time goes on the board.
          </small>
        </span>
      </button>

      {loading && (
        <p className={styles.hint}>
          <Loader2 size={12} className={styles.spin} /> Loading the catalog…
        </p>
      )}

      {cascades.length > 0 && (
        <>
          <p className={styles.drillGroup}>
            Cascades · {cascades.length}
            <span>
              Several incidents in sequence, where resolving one causes the next.
              Practising a cascade records a time but does not rank it.
            </span>
          </p>
          <div className={styles.drills}>
            {cascades.map((d) => (
              <DrillRow
                key={d.id}
                drill={d}
                busy={busy}
                disabled={locked}
                onStart={() =>
                  act(`drill-${d.id}`, () => startDrill(run.runId, d.id))
                }
              />
            ))}
          </div>
        </>
      )}

      {singles.length > 0 && (
        <>
          <p className={styles.drillGroup}>
            Single incidents · {singles.length}
            <span>One fault, one objective. Where to learn each lever.</span>
          </p>
          <div className={styles.drills}>
            {singles.map((d) => (
              <DrillRow
                key={d.id}
                drill={d}
                busy={busy}
                disabled={locked}
                onStart={() =>
                  act(`drill-${d.id}`, () => startDrill(run.runId, d.id))
                }
              />
            ))}
          </div>
        </>
      )}

      {provisioning && (
        <p className={styles.hint}>
          Drills unlock once the workload is serving traffic.
        </p>
      )}
    </>
  );
}

/** Every stage cleared. The cluster survives the drill — only the objective ends. */
function DrillSolved({
  run,
  title,
  stat,
  busy,
  act,
}: {
  run: LiveRunView;
  title: string;
  stat: DrillCatalogEntry | undefined;
  busy: string | null;
  act: Act;
}) {
  // The incident really was resolved, so the drill really is over — an incident cannot be
  // un-resolved by how you got there. But getting there by applying an action that does not work is
  // not the same result, and celebrating it identically teaches that it is. A clean resolution is
  // congratulated; one carrying missteps is acknowledged, and says what they cost.
  const clean = run.drillWrongChosen === 0;
  const ranked = run.drillMode === "ranked";
  const parMs = run.drillParSeconds * 1000;
  const beatPar = parMs > 0 && run.elapsedMs < parMs;
  // Compared against the average BEFORE this run was folded into it, which is what makes the
  // comparison mean anything on a drill with few attempts.
  const average = stat?.averageMs ?? 0;

  return (
    <div className={`${styles.solved} ${clean ? "" : styles.solvedMessy}`}>
      <span className={styles.solvedIcon}>
        {clean ? <PartyPopper size={22} /> : <ShieldCheck size={22} />}
      </span>
      <b>{clean ? "Drill complete" : "Resolved, the hard way"}</b>
      <p className={styles.solvedName}>
        {title}
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

      {/* What the time is worth. Par is the drill's reference; the average is everyone's. */}
      <div className={styles.compareRow}>
        <span className={beatPar ? styles.okText : ""}>
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
        <p className={styles.solvedSub}>
          You worked {run.drillStageCount} consecutive incidents on this cluster,
          each one caused by the fix before it.
        </p>
      )}
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
        {ranked
          ? "Your time is recorded. The cluster is still yours — draw another ranked run, or keep experimenting with the controls."
          : "This time is recorded and counts towards the drill's average. The cluster is still yours — run another drill on it, or keep experimenting."}
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
 * What the stage is actually waiting for, measured live. Showing the conditions rather than a
 * verdict means the objective can be worked towards deliberately — and it is honest about why the
 * stage has not ended yet.
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

/** Where the cascade has got to. One pip per stage, so the shape of the drill is visible up front. */
function StageTrack({ run }: { run: LiveRunView }) {
  if (run.drillStageCount <= 1) return null;
  return (
    <div className={styles.stageTrack} title={`Stage ${run.drillStage} of ${run.drillStageCount}`}>
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

/** A stage in progress: the objective, and the decisions that are really applied to the cluster. */
function DrillInProgress({
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
  const met = run.drillGoals.filter((g) => g.met).length;
  const allMet = run.drillGoals.length > 0 && met === run.drillGoals.length;
  const progress = Math.min(
    100,
    (met / Math.max(1, run.drillGoals.length)) * 100,
  );

  return (
    <>
      <div className={styles.objective}>
        <b>
          {title}
          {run.drillMode === "ranked" && (
            <span className={styles.rankedTag}>Ranked</span>
          )}
        </b>
        {run.drillStageTitle && (
          <p className={styles.stageName}>{run.drillStageTitle}</p>
        )}
        <p>{run.drillStageObjective || run.drillObjective}</p>
        <span>
          {met} of {run.drillGoals.length} conditions met ·{" "}
          {clock(run.elapsedMs)} elapsed
          {run.offeredRequestsPerSec > 0 &&
            ` · ${run.offeredRequestsPerSec}/s offered`}
        </span>
      </div>

      <StageTrack run={run} />

      {/* The handover note. Without it, an incident that the operator's own fix caused reads as the
          platform being arbitrary — which is the opposite of the lesson. */}
      {run.drillStageHandoff && (
        <p className={styles.handoff}>
          <AlertTriangle size={12} />
          <span>{run.drillStageHandoff}</span>
        </p>
      )}

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
        to your cluster — the stage ends when the objective above is actually
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
  const [catalog, setCatalog] = useState<DrillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Loaded from the API rather than duplicated in the bundle: the catalog carries solve statistics
  // that only the server can know, and a second copy of the drill list here would drift from it.
  const load = useCallback(() => {
    let alive = true;
    fetchDrills()
      .then((c) => alive && setCatalog(c.drills))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(load, [load]);

  // Refresh the averages when a drill resolves, so the number this run just changed is the number
  // the picker shows next.
  const solved = run.drillSolved;
  useEffect(() => {
    if (solved) return load();
  }, [solved, load]);

  const stat = catalog.find((d) => d.id === run.drillId);

  if (!run.drillId)
    return (
      <DrillPicker
        run={run}
        busy={busy}
        provisioning={provisioning}
        catalog={catalog}
        loading={loading}
        act={act}
      />
    );

  const title = run.drillTitle || stat?.title || "Drill";
  if (run.drillSolved)
    return (
      <DrillSolved run={run} title={title} stat={stat} busy={busy} act={act} />
    );

  return <DrillInProgress run={run} title={title} busy={busy} act={act} />;
}
