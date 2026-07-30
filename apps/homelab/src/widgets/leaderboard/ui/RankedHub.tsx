"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Check,
  Clock3,
  Flame,
  Gauge,
  History,
  Loader2,
  Lock,
  Play,
  Radio,
  Server,
  ShieldCheck,
  Shuffle,
  Signal,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import { AUTH_URL, HOMELAB_URL } from "@iw/core";
import {
  fetchDrills,
  fetchRankedProfile,
  type DrillCatalogEntry,
  type LivePlatformStatus,
  type LiveRunView,
  type LiveStatus,
  type RankedProfile,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import { useLeaderboard } from "../model/useLeaderboard";
import { BoardSkeleton } from "./BoardSkeleton";
import { RatingBoard } from "./RatingBoard";
import { TimeBoard } from "./TimeBoard";
import styles from "../leaderboard.module.css";

type BoardMode = "elo" | "time";

export function RankedHub({
  status,
  platform,
  run,
  busy,
  provisioning,
  expired,
  error,
  launching,
  onLaunch,
}: {
  status: LiveStatus;
  platform: LivePlatformStatus | null;
  run: LiveRunView | null;
  busy: string | null;
  provisioning: boolean;
  expired: boolean;
  error: string | null;
  launching: boolean;
  onLaunch: () => void;
}) {
  const boardState = useLeaderboard();
  const [boardMode, setBoardMode] = useState<BoardMode>("elo");
  const [eligible, setEligible] = useState<DrillCatalogEntry[] | null>(null);
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchDrills()
      .then((catalog) => {
        if (alive)
          setEligible(catalog.drills.filter((drill) => drill.stageCount > 1));
      })
      .catch(() => {
        if (!alive) return;
        setEligible([]);
        setPoolError(
          "The ranked scenario pool is unavailable. Matchmaking will resume when the control plane is ready.",
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!status.signedIn) return;
    let alive = true;
    fetchRankedProfile()
      .then((next) => {
        if (alive) setProfile(next);
      })
      .catch(() => {
        if (alive)
          setLedgerError(
            "The ranked ledger is unavailable. Matchmaking is paused until results can be recorded safely.",
          );
      });
    return () => {
      alive = false;
    };
  }, [status.signedIn]);

  const slots = platform?.slotsAvailable ?? null;
  const poolLoading = eligible === null;
  const poolSize = eligible?.length ?? 0;
  const hasArena = run !== null;
  const actionBusy = busy !== null || launching;
  const actionLocked =
    actionBusy ||
    poolLoading ||
    poolSize === 0 ||
    ledgerError !== null ||
    poolError !== null ||
    !status.enabled ||
    (!hasArena && slots === 0);
  const recent =
    profile?.recentAttempts
      .filter(
        (attempt) => attempt.outcome !== "active" && attempt.outcome !== "void",
      )
      .slice(0, 5) ?? [];
  const scenarioName = (id: string) =>
    eligible?.find((drill) => drill.id === id)?.title ??
    id.replace(/^cascade-/, "").replaceAll("-", " ");
  const signInUrl = `${AUTH_URL}/login?returnUrl=${encodeURIComponent(
    `${HOMELAB_URL}/ranked`,
  )}`;

  const actionLabel = () => {
    if (launching) return "Opening secure launch…";
    if (busy === "provision") return "Preparing arena…";
    if (provisioning) return "Resume arena setup";
    if (busy === "ranked") return "Activating incident…";
    if (!status.enabled) return "Live control offline";
    if (!hasArena && slots === 0) return "All arena slots busy";
    return hasArena ? "Resume ranked launch" : "Start ranked";
  };

  const fastest = boardState.times?.entries[0] ?? null;

  return (
    <main className={styles.rankedPage}>
      <header className={styles.rankHeader}>
        <div>
          <p>
            <Signal size={12} /> Live ranked · seasonless
          </p>
          <h1>Ranked operations</h1>
          <span>
            Real Kubernetes incidents. Measured recovery. One rating ladder.
          </span>
        </div>
        <div className={styles.systemStatus} aria-label="Ranked system status">
          <span>
            <Server size={12} />
            {platform
              ? `${platform.nodesReady}/${platform.nodesTotal} nodes`
              : "Reading cluster"}
          </span>
          <span>
            <Radio size={12} />
            {poolLoading ? "Reading pool" : `${poolSize} incidents`}
          </span>
          <span>
            <Activity size={12} />
            {slots === null ? "Reading capacity" : `${slots} slots free`}
          </span>
        </div>
      </header>

      {(error || ledgerError || poolError || expired) && (
        <div className={styles.notices} role="status">
          {expired && (
            <p>
              <Timer size={14} />
              Your previous arena expired safely. Prepare another to rejoin.
            </p>
          )}
          {(error || ledgerError || poolError) && (
            <p className={styles.error}>
              <ShieldCheck size={14} />
              {error ?? ledgerError ?? poolError}
            </p>
          )}
        </div>
      )}

      <div className={styles.rankedLayout}>
        <aside className={styles.rankSidebar}>
          <section className={styles.queueCard}>
            <header>
              <span>Match queue</span>
              <i>{hasArena ? "Arena ready" : "Standby"}</i>
            </header>
            <h2>
              {hasArena
                ? "Your isolated cluster is ready."
                : "Draw an incident calibrated to you."}
            </h2>
            <p>
              The fault stays hidden. Investigate real telemetry, operate
              through the audited console, and hold the measured objective.
            </p>
            {status.signedIn ? (
              <button
                type="button"
                className={styles.queueAction}
                onClick={onLaunch}
                disabled={actionLocked}
              >
                {actionBusy ? (
                  <Loader2 size={15} className={styles.spin} />
                ) : hasArena ? (
                  <Trophy size={15} />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
                {actionLabel()}
              </button>
            ) : (
              <a className={styles.queueAction} href={signInUrl}>
                <Lock size={15} /> Sign in to compete
              </a>
            )}
            <div className={styles.queueFacts}>
              <span>
                <Shuffle size={11} /> rating-matched draw
              </span>
              <span>
                <Gauge size={11} /> outcome judged
              </span>
            </div>
          </section>

          <section className={styles.operatorPanel}>
            <header>
              <span>Operator</span>
              <i data-online={status.signedIn}>
                {status.signedIn ? "Verified" : "Guest"}
              </i>
            </header>
            <div className={styles.operatorRating}>
              <div>
                <small>{profile?.division ?? "Unranked"}</small>
                <strong>{profile?.rating ?? "—"}</strong>
              </div>
              <span>{status.displayName ?? "No ranked identity"}</span>
            </div>
            <dl className={styles.operatorStats}>
              <div>
                <dt>Rank</dt>
                <dd>{profile?.ladderRank ? `#${profile.ladderRank}` : "—"}</dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd>{profile ? `${profile.wins}–${profile.losses}` : "—"}</dd>
              </div>
              <div>
                <dt>Streak</dt>
                <dd>
                  <Flame size={11} /> {profile?.currentStreak ?? 0}
                </dd>
              </div>
              <div>
                <dt>Peak</dt>
                <dd>{profile?.peakRating ?? "—"}</dd>
              </div>
            </dl>
            {profile?.divisionCeiling && (
              <div className={styles.ratingTrack}>
                <span>
                  {profile.division}
                  <b>{Math.round(profile.divisionProgress * 100)}%</b>
                </span>
                <i>
                  <b style={{ width: `${profile.divisionProgress * 100}%` }} />
                </i>
              </div>
            )}
          </section>

          <section className={styles.recentPanel}>
            <header>
              <span>
                <History size={12} /> Recent matches
              </span>
              <b>{profile?.gamesPlayed ?? 0} played</b>
            </header>
            {recent.length > 0 ? (
              <div className={styles.recentList}>
                {recent.map((attempt) => {
                  const won = attempt.outcome === "completed";
                  return (
                    <article key={attempt.id}>
                      <i data-won={won}>
                        {won ? <Check size={10} /> : <X size={10} />}
                      </i>
                      <span>
                        <b>{scenarioName(attempt.drillId)}</b>
                        <small>
                          {won
                            ? clock(attempt.elapsedMs)
                            : attempt.outcome.replaceAll("-", " ")}
                        </small>
                      </span>
                      <strong data-positive={attempt.ratingDelta >= 0}>
                        {attempt.ratingDelta >= 0 ? "+" : ""}
                        {attempt.ratingDelta}
                      </strong>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className={styles.emptyRecent}>No rated matches yet.</p>
            )}
          </section>

          <section className={styles.protocolMini}>
            <span>
              <Radio size={12} /> Real isolated workload
            </span>
            <span>
              <ShieldCheck size={12} /> Server-authoritative result
            </span>
            <span>
              <Clock3 size={12} /> Time never changes ELO
            </span>
          </section>
        </aside>

        <section className={styles.rankMain} id="standings">
          <header className={styles.boardHeader}>
            <div>
              <p>Standings</p>
              <h2>
                {boardMode === "elo" ? "Operator ladder" : "Recovery times"}
              </h2>
              <span>
                {boardMode === "elo"
                  ? "The default competitive view. Wins and losses move a seasonless ELO rating."
                  : "Successful matches only, ordered by each operator’s fastest verified recovery."}
              </span>
            </div>
            <div
              className={styles.boardSwitch}
              role="tablist"
              aria-label="Leaderboard measure"
            >
              <button
                type="button"
                role="tab"
                aria-selected={boardMode === "elo"}
                className={boardMode === "elo" ? styles.switchOn : ""}
                onClick={() => setBoardMode("elo")}
              >
                <Trophy size={12} /> ELO
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={boardMode === "time"}
                className={boardMode === "time" ? styles.switchOn : ""}
                onClick={() => setBoardMode("time")}
              >
                <Clock3 size={12} /> Time
              </button>
            </div>
          </header>

          <div className={styles.boardSummary}>
            {boardMode === "elo" ? (
              <>
                <div>
                  <span>Rated operators</span>
                  <b>
                    {profile?.ratedOperators ??
                      boardState.standings?.length ??
                      0}
                  </b>
                </div>
                <div>
                  <span>Your rating</span>
                  <b>{profile?.rating ?? "—"}</b>
                </div>
                <div>
                  <span>Your peak</span>
                  <b>{profile?.peakRating ?? "—"}</b>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Timed operators</span>
                  <b>{boardState.times?.entries.length ?? 0}</b>
                </div>
                <div>
                  <span>Fastest recovery</span>
                  <b>{fastest ? clock(fastest.bestMs) : "—"}</b>
                </div>
                <div>
                  <span>Current holder</span>
                  <b>{fastest?.displayName ?? "Open"}</b>
                </div>
              </>
            )}
          </div>

          {boardState.error && (
            <p className={styles.boardError}>{boardState.error}</p>
          )}
          <p className={styles.status} role="status">
            {boardState.loading ? "Reading live standings…" : ""}
          </p>
          {boardState.loading && <BoardSkeleton />}

          {!boardState.loading &&
            !boardState.error &&
            (boardMode === "elo" ? (
              <RatingBoard entries={boardState.standings ?? []} />
            ) : (
              <TimeBoard entries={boardState.times?.entries ?? []} />
            ))}

          <footer className={styles.boardFooter}>
            <p>
              <b>ELO is the default.</b> It measures whether you restore the
              objective against difficulty calibrated near your rating.
            </p>
            <p>
              <b>Time is separate.</b> It records execution speed only after a
              recovery survives the verification window.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
