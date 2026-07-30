"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
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
  startDrill,
  type DrillCatalogEntry,
  type LivePlatformStatus,
  type LiveRunView,
  type LiveStatus,
  type RankedProfile,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import { PODIUM_PLACES } from "../model/board";
import { useLeaderboard } from "../model/useLeaderboard";
import { BoardSkeleton } from "./BoardSkeleton";
import { BoardTable } from "./BoardTable";
import { Podium } from "./Podium";
import { RatingBoard } from "./RatingBoard";
import { SectionHead } from "./SectionHead";
import styles from "../leaderboard.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

export function RankedHub({
  status,
  platform,
  run,
  busy,
  provisioning,
  expired,
  error,
  onProvision,
  act,
}: {
  status: LiveStatus;
  platform: LivePlatformStatus | null;
  run: LiveRunView | null;
  busy: string | null;
  provisioning: boolean;
  expired: boolean;
  error: string | null;
  onProvision: () => void;
  act: Act;
}) {
  const boardState = useLeaderboard();
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
        if (alive) {
          setEligible([]);
          setPoolError(
            "The ranked scenario pool is unavailable. Matchmaking will resume when the control plane is ready.",
          );
        }
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
  const actionBusy = busy !== null || provisioning;
  const actionLocked = hasArena
    ? actionBusy ||
      poolLoading ||
      poolSize === 0 ||
      ledgerError !== null ||
      poolError !== null
    : actionBusy || !status.enabled || slots === 0;
  const recent =
    profile?.recentAttempts
      .filter(
        (attempt) => attempt.outcome !== "active" && attempt.outcome !== "void",
      )
      .slice(0, 4) ?? [];
  const scenarioName = (id: string) =>
    eligible?.find((drill) => drill.id === id)?.title ??
    id.replace(/^cascade-/, "").replaceAll("-", " ");
  const signInUrl = `${AUTH_URL}/login?returnUrl=${encodeURIComponent(
    `${HOMELAB_URL}/ranked`,
  )}`;

  const actionLabel = () => {
    if (busy === "provision" || provisioning) return "Preparing live arena…";
    if (busy === "ranked") return "Drawing incident…";
    if (!status.enabled) return "Live control offline";
    if (!hasArena && slots === 0) return "All arena slots busy";
    return hasArena ? "Enter ranked match" : "Prepare ranked arena";
  };

  const play = () => {
    if (!run) {
      onProvision();
      return;
    }
    act("ranked", () => startDrill(run.runId, "", "ranked"));
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="ranked-title">
        <div className={styles.heroCopy}>
          <p className={styles.livePill}>
            <Signal size={12} />
            Live ranked · seasonless
          </p>
          <h1 id="ranked-title">
            Operate under pressure.
            <span> Climb the board.</span>
          </h1>
          <p className={styles.lede}>
            Real Kubernetes incidents, one clean attempt at a time. Every
            verdict moves your rating. Successful recoveries also keep an
            official clock, so consistency and speed stay separate.
          </p>

          <div className={styles.heroActions}>
            {status.signedIn ? (
              <button
                type="button"
                className={styles.primaryAction}
                onClick={play}
                disabled={actionLocked}
              >
                {actionBusy ? (
                  <Loader2 size={16} className={styles.spin} />
                ) : hasArena ? (
                  <Trophy size={16} />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
                {actionLabel()}
              </button>
            ) : (
              <a className={styles.primaryAction} href={signInUrl}>
                <Lock size={16} />
                Sign in to compete
              </a>
            )}
            <a className={styles.secondaryAction} href="#standings">
              View standings <ArrowRight size={14} />
            </a>
          </div>

          <div className={styles.signalRow} aria-label="Ranked system status">
            <span>
              <Server size={13} />
              {platform
                ? `${platform.nodesReady}/${platform.nodesTotal} nodes ready`
                : "Reading cluster"}
            </span>
            <span>
              <Radio size={13} />
              {poolLoading ? "Reading match pool" : `${poolSize} cascades live`}
            </span>
            <span>
              <Activity size={13} />
              {hasArena
                ? provisioning
                  ? "Arena converging"
                  : "Arena ready"
                : slots === null
                  ? "Reading capacity"
                  : `${slots} arena ${slots === 1 ? "slot" : "slots"} free`}
            </span>
          </div>
        </div>

        <aside className={styles.operatorCard} aria-label="Operator rating">
          <header className={styles.operatorHead}>
            <span>Operator card</span>
            <i data-online={status.signedIn}>
              {status.signedIn ? "Verified" : "Guest"}
            </i>
          </header>

          <div className={styles.operatorIdentity}>
            <div>
              <span>{profile?.division ?? "Unranked"}</span>
              <strong>{profile?.rating ?? "—"}</strong>
              <small>seasonless rating</small>
            </div>
            <p>{status.displayName ?? "Sign in to establish your rating"}</p>
          </div>

          {profile?.divisionCeiling && (
            <div className={styles.ratingTrack}>
              <span>
                {profile.division} progress
                <b>{Math.round(profile.divisionProgress * 100)}%</b>
              </span>
              <i>
                <b style={{ width: `${profile.divisionProgress * 100}%` }} />
              </i>
            </div>
          )}

          <dl className={styles.operatorStats}>
            <div>
              <dt>Ladder</dt>
              <dd>{profile?.ladderRank ? `#${profile.ladderRank}` : "—"}</dd>
            </div>
            <div>
              <dt>Record</dt>
              <dd>{profile ? `${profile.wins}–${profile.losses}` : "—"}</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>
                <Flame size={12} /> {profile?.currentStreak ?? 0}
              </dd>
            </div>
            <div>
              <dt>Peak</dt>
              <dd>{profile?.peakRating ?? "—"}</dd>
            </div>
          </dl>

          {profile && profile.provisionalGamesRemaining > 0 && (
            <p className={styles.profileNote}>
              {profile.provisionalGamesRemaining} placement{" "}
              {profile.provisionalGamesRemaining === 1 ? "match" : "matches"}{" "}
              remaining
            </p>
          )}
          {!status.signedIn && (
            <p className={styles.profileNote}>
              The ladder is public. Playing requires a verified HomeOps session.
            </p>
          )}
        </aside>
      </section>

      {(error || ledgerError || poolError || expired) && (
        <div className={styles.notices} role="status">
          {expired && (
            <p>
              <Timer size={14} />
              Your previous arena expired safely. Prepare another to rejoin the
              queue.
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

      <section
        className={styles.briefingGrid}
        aria-label="Ranked match briefing"
      >
        <div className={styles.protocol}>
          <header>
            <span>Match protocol</span>
            <b>What makes a run official</b>
          </header>
          <div>
            <article>
              <Radio size={16} />
              <span>
                <b>Real workload</b>
                Every action changes an isolated Kubernetes namespace.
              </span>
            </article>
            <article>
              <Shuffle size={16} />
              <span>
                <b>Blind draw</b>
                The server chooses the multi-stage incident after you commit.
              </span>
            </article>
            <article>
              <ShieldCheck size={16} />
              <span>
                <b>One shot</b>A wrong move, forfeit, or expiry closes the rated
                attempt.
              </span>
            </article>
            <article>
              <Gauge size={16} />
              <span>
                <b>Two records</b>
                ELO measures results; the clock measures clean execution.
              </span>
            </article>
          </div>
        </div>

        <div className={styles.recentPanel}>
          <header>
            <span>
              <History size={13} /> Your latest matches
            </span>
            {profile && (
              <b>
                {profile.gamesPlayed
                  ? `${Math.round((profile.wins / profile.gamesPlayed) * 100)}% win rate`
                  : "Awaiting placement"}
              </b>
            )}
          </header>
          {recent.length > 0 ? (
            <div className={styles.recentList}>
              {recent.map((attempt) => {
                const won = attempt.outcome === "completed";
                return (
                  <article key={attempt.id}>
                    <i data-won={won}>
                      {won ? <Check size={11} /> : <X size={11} />}
                    </i>
                    <span>
                      <b>{scenarioName(attempt.drillId)}</b>
                      <small>
                        {won
                          ? `${clock(attempt.elapsedMs)} official`
                          : `${attempt.outcome} · stage ${attempt.stageReached}`}
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
            <div className={styles.emptyRecent}>
              <Trophy size={18} />
              <span>
                <b>No rated matches yet</b>
                Your first result starts the operator record.
              </span>
            </div>
          )}
        </div>
      </section>

      <section className={styles.boards} id="standings">
        <div className={styles.boardIntro}>
          <p>Competitive record</p>
          <h2>One ladder. Two ways to prove yourself.</h2>
          <span>
            Rating rewards reliable decisions across every outcome. Speed
            records only count successful recoveries.
          </span>
        </div>

        {boardState.error && (
          <p className={styles.boardError}>{boardState.error}</p>
        )}
        <p className={styles.status} role="status">
          {boardState.loading ? "Reading live standings…" : ""}
        </p>
        {boardState.loading && <BoardSkeleton />}

        {boardState.board && boardState.standings && (
          <>
            <SectionHead
              index="01"
              title="Operator ladder"
              note="Seasonless ELO across wins, failures, forfeits, and expiries."
            />
            <RatingBoard entries={boardState.standings} />

            <SectionHead
              index="02"
              title="Speed podium"
              note="Clean recoveries only. Fast execution never changes rating."
            />
            <Podium entries={boardState.board.overall} />

            {boardState.board.overall.length > PODIUM_PLACES.length && (
              <BoardTable
                title="Overall circuit"
                note="Breadth of cascades resolved, then average official time."
                entries={boardState.board.overall}
                overall
              />
            )}

            <SectionHead
              index="03"
              title="Cascade records"
              note="The fastest verified recovery for each live scenario."
            />
            <div className={styles.grid}>
              {boardState.board.byDrill.map((drill, index) => (
                <BoardTable
                  key={drill.drillId}
                  title={drill.title}
                  entries={drill.entries}
                  overall={false}
                  index={index}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
