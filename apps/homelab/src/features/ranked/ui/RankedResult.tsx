"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Gauge,
  Loader2,
  RotateCcw,
  ShieldX,
  Timer,
  Trophy,
} from "lucide-react";
import {
  endDrill,
  fetchDrills,
  fetchRankedProfile,
  type DrillCatalogEntry,
  type LiveRunView,
  type RankedAttempt,
  type RankedProfile,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import styles from "../ranked.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/** A competitive result keeps rating and execution speed distinct: ELO measures consistency,
 * while the official clock remains the speed record for successful recoveries. */
export function RankedResult({
  run,
  busy,
  act,
}: {
  run: LiveRunView;
  busy: string | null;
  act: Act;
}) {
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [attempt, setAttempt] = useState<RankedAttempt | null>(null);
  const [scenario, setScenario] = useState<DrillCatalogEntry | null>(null);
  const [readFinished, setReadFinished] = useState(false);
  const won = run.drillSolved;

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let reads = 0;

    const read = () => {
      reads += 1;
      fetchRankedProfile()
        .then((next) => {
          if (!alive) return;
          setProfile(next);
          const match = next.recentAttempts.find(
            (item) => item.runId === run.runId && item.drillId === run.drillId,
          );
          setAttempt(match ?? null);
          if ((!match || match.outcome === "active") && reads < 4)
            retry = setTimeout(read, 650);
          else setReadFinished(true);
        })
        .catch(() => {
          if (alive && reads < 4) retry = setTimeout(read, 650);
          else if (alive) setReadFinished(true);
        });
    };

    read();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
    };
  }, [run.drillId, run.runId]);

  useEffect(() => {
    let alive = true;
    fetchDrills()
      .then((catalog) => {
        if (alive)
          setScenario(
            catalog.drills.find((drill) => drill.id === run.drillId) ?? null,
          );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [run.drillId]);

  const settled = attempt && attempt.outcome !== "active";
  const delta = settled ? attempt.ratingDelta : null;
  const failed = run.drillOptions.find(
    (option) => option.id === run.drillFailedMove,
  );
  const debrief = attempt?.debrief ?? run.rankedDebrief;

  return (
    <div className={`${styles.result} ${won ? "" : styles.lost}`}>
      <span className={styles.resultIcon}>
        {won ? <Trophy size={27} /> : <ShieldX size={27} />}
      </span>
      <p className={styles.resultEyebrow}>
        {won ? "Incident contained" : "Attempt ended"}
      </p>
      <h2>{won ? "Verified recovery" : "Attempt failed"}</h2>
      <p className={styles.resultScenario}>{run.drillTitle}</p>

      <div className={styles.ratingChange} aria-live="polite">
        <div>
          <span>Rating</span>
          <b>{settled ? attempt.preRating : "—"}</b>
        </div>
        <span
          className={
            delta === null
              ? styles.deltaPending
              : delta >= 0
                ? styles.deltaUp
                : styles.deltaDown
          }
        >
          {delta === null ? (
            <Loader2 size={14} className={styles.spin} />
          ) : delta >= 0 ? (
            <ArrowUp size={14} />
          ) : (
            <ArrowDown size={14} />
          )}
          {delta === null ? "sealing" : `${delta >= 0 ? "+" : ""}${delta}`}
        </span>
        <div>
          <span>New rating</span>
          <b>{settled ? attempt.postRating : "—"}</b>
        </div>
      </div>

      {settled && (
        <div className={styles.calibration}>
          <span>
            Scenario rating <b>{attempt.scenarioRating}</b>
          </span>
          <i />
          <span>
            Expected score <b>{Math.round(attempt.expectedScore * 100)}%</b>
          </span>
          {profile && profile.provisionalGamesRemaining > 0 && (
            <>
              <i />
              <span>
                <b>{profile.provisionalGamesRemaining}</b> placements left
              </span>
            </>
          )}
        </div>
      )}

      <div className={styles.resultStats}>
        <div>
          <span>Division</span>
          <b>{profile?.division ?? "—"}</b>
        </div>
        <div>
          <span>{won ? "Official time" : "Time survived"}</span>
          <b>{clock(settled ? attempt.elapsedMs : run.elapsedMs)}</b>
        </div>
        <div>
          <span>Stage reached</span>
          <b>
            {settled ? attempt.stageReached : run.drillStage}/
            {run.drillStageCount}
          </b>
        </div>
      </div>

      {settled && attempt.performance && (
        <section className={styles.performanceCard}>
          <header>
            <span>Operational quality</span>
            <b>
              {attempt.performance.qualityScore}/100 ·{" "}
              {attempt.performance.band}
            </b>
          </header>
          <div className={styles.performanceGrid}>
            <div>
              <span>SLO health</span>
              <b>{attempt.performance.sloHealthScore}%</b>
            </div>
            <div>
              <span>Objective control</span>
              <b>{attempt.performance.objectiveHealthScore}%</b>
            </div>
            <div>
              <span>Action discipline</span>
              <b>{attempt.performance.actionScore}%</b>
            </div>
            <div>
              <span>Containment</span>
              <b>{attempt.performance.containmentScore}%</b>
            </div>
          </div>
          <div className={styles.performanceAudit}>
            <span>
              <b>{attempt.performance.targetedActions}</b> targeted
            </span>
            <span>
              <b>{attempt.performance.harmfulActions}</b> harmful
            </span>
            <span>
              <b>{attempt.performance.unnecessaryActions}</b> unnecessary
            </span>
            <span>
              <b>{attempt.performance.redundantActions}</b> repeated
            </span>
            <span>
              <b>{attempt.performance.convergenceViolations}</b> before converge
            </span>
          </div>
          <p>
            Peak {Math.round(attempt.performance.peakP95LatencyMs)}ms p95 ·{" "}
            {attempt.performance.peakErrorRatePct.toFixed(1)}% errors ·{" "}
            {attempt.performance.sampleCount} measured windows
          </p>
          <small>
            Rating result {Math.round(attempt.performance.ratingScore * 100)}%.
            Official time is excluded from this score.
          </small>
        </section>
      )}

      {debrief && (
        <section className={styles.debriefCard}>
          <header>
            <div>
              <span>Generated incident debrief</span>
              <b>
                Seed {debrief.seedId.slice(0, 12)} · generator v
                {debrief.generatorVersion}
              </b>
            </div>
            <strong>{debrief.difficultyScore.toFixed(1)} difficulty</strong>
          </header>
          <div className={styles.faultGrid}>
            {debrief.faults.map((fault) => (
              <article key={`${fault.phase}-${fault.moduleId}`}>
                <span>
                  Phase {fault.phase}
                  {fault.wasHidden ? " · hidden escalation" : ""}
                  {fault.activationDelaySeconds > 0
                    ? ` · +${fault.activationDelaySeconds}s`
                    : ""}
                </span>
                <h3>{fault.label}</h3>
                <p>{fault.diagnosis}</p>
                <small>
                  Resolved by{" "}
                  {fault.resolvedBy.length > 0
                    ? fault.resolvedBy.join(" or ")
                    : "measured state convergence"}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className={styles.actionLog}>
        <header>
          <span>Operational timeline</span>
          <b>{run.rankedActions.length}</b>
        </header>
        {run.rankedActions.length === 0 ? (
          <p>No operator mutations were recorded.</p>
        ) : (
          run.rankedActions.map((action) => (
            <div key={action.id}>
              <time>{clock(action.acceptedAtMs)}</time>
              <code>{action.command}</code>
            </div>
          ))
        )}
      </div>

      {won && (scenario || run.rankedBriefing) && (
        <div className={styles.speedCompare}>
          <span>
            <Timer size={10} /> par{" "}
            {clock(
              (scenario?.parSeconds ?? run.rankedBriefing?.parSeconds ?? 0) *
                1000,
            )}
          </span>
          {(scenario?.averageMs ?? 0) > 0 && (
            <span>
              <Gauge size={10} /> field {clock(scenario?.averageMs ?? 0)}
            </span>
          )}
          {scenario?.yourBestMs && (
            <span
              className={
                attempt?.elapsedMs === scenario.yourBestMs
                  ? styles.personalBest
                  : ""
              }
            >
              <Trophy size={10} /> best {clock(scenario.yourBestMs)}
            </span>
          )}
        </div>
      )}

      {!won && failed && (
        <div className={styles.callout}>
          <b>{failed.label}</b>
          <p>{failed.explanation}</p>
        </div>
      )}

      <p className={styles.resultNote}>
        {won
          ? "The measured objective held through verification. Rating rewards that result; official time stays a separate speed record."
          : "The cluster stayed measurable after every action, so the timeline remains available for review before resetting."}
      </p>

      <button
        className={styles.start}
        onClick={() => act("end", () => endDrill(run.runId))}
        disabled={busy !== null || (!settled && !readFinished)}
      >
        {busy === "end" || (!settled && !readFinished) ? (
          <Loader2 size={14} className={styles.spin} />
        ) : (
          <RotateCcw size={14} />
        )}
        {!settled && !readFinished
          ? "Sealing match result…"
          : "Return to ranked queue"}
      </button>

      <a className={styles.boardLink} href="/ranked#standings">
        Open standings <ArrowRight size={12} />
      </a>
    </div>
  );
}
