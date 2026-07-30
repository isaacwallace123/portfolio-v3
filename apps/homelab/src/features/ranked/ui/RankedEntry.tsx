"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Flame,
  History,
  Loader2,
  Radio,
  ShieldCheck,
  Shuffle,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import {
  fetchDrills,
  fetchRankedProfile,
  startDrill,
  type DrillCatalogEntry,
  type LiveRunView,
  type RankedProfile,
} from "@/shared/api/live-client";
import styles from "../ranked.module.css";
import { clock } from "@/shared/lib/format";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

/**
 * Ranked owns its own entry state. It deliberately does not reuse the practice catalog: a
 * competitive operator commits to the rules first, and the broker draws the cascade afterwards.
 */
export function RankedEntry({
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
  const [eligible, setEligible] = useState<DrillCatalogEntry[]>([]);
  const [profile, setProfile] = useState<RankedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchDrills(), fetchRankedProfile()])
      .then(([catalog, rankedProfile]) => {
        if (alive)
          setEligible(catalog.drills.filter((drill) => drill.stageCount > 1));
        if (alive) setProfile(rankedProfile);
      })
      .catch(() => {
        if (alive)
          setLoadError(
            "The ranked ledger is unavailable. New matches are paused until results can be recorded safely.",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const locked =
    provisioning || busy !== null || loading || eligible.length === 0;
  const recent =
    profile?.recentAttempts
      .filter(
        (attempt) => attempt.outcome !== "active" && attempt.outcome !== "void",
      )
      .slice(0, 3) ?? [];
  const scenarioName = (id: string) =>
    eligible.find((drill) => drill.id === id)?.title ??
    id.replace(/^cascade-/, "").replaceAll("-", " ");

  return (
    <div className={styles.entry}>
      <header className={styles.heading}>
        <p>
          <Trophy size={12} /> Competitive operations
        </p>
        <h2>One live cascade. One shot.</h2>
        <span>
          The control plane draws the incident after you commit. Resolve every
          stage cleanly to gain rating and record an official time.
        </span>
      </header>

      <section className={styles.ratingCard}>
        <div className={styles.ratingMain}>
          <span>{profile?.division ?? "Unranked"}</span>
          <b>{profile?.rating ?? "—"}</b>
          <small>
            {profile ? `peak ${profile.peakRating}` : "operator rating"}
          </small>
        </div>
        <div className={styles.ratingMeta}>
          <span>
            <b>{profile?.gamesPlayed ?? 0}</b> matches
          </span>
          <span>
            <b>{profile?.ladderRank ? `#${profile.ladderRank}` : "—"}</b>{" "}
            {profile?.ratedOperators
              ? `of ${profile.ratedOperators}`
              : "ladder"}
          </span>
          <span>
            <b>
              {profile?.gamesPlayed
                ? Math.round((profile.wins / profile.gamesPlayed) * 100)
                : 0}
              %
            </b>{" "}
            win rate
          </span>
          {(profile?.currentStreak ?? 0) > 0 && (
            <span>
              <Flame size={11} />
              <b>{profile?.currentStreak}</b> streak
            </span>
          )}
        </div>
        {profile && profile.provisionalGamesRemaining > 0 && (
          <p className={styles.provisional}>
            {profile.provisionalGamesRemaining} placement{" "}
            {profile.provisionalGamesRemaining === 1 ? "match" : "matches"}{" "}
            remaining
          </p>
        )}
        {profile?.divisionCeiling && (
          <div
            className={styles.ratingProgress}
            aria-label={`${Math.round(profile.divisionProgress * 100)}% toward the next division`}
          >
            <i style={{ width: `${profile.divisionProgress * 100}%` }} />
          </div>
        )}
      </section>

      {(profile?.gamesPlayed ?? 0) === 0 ? (
        <div className={styles.rules}>
          <div>
            <Radio size={15} />
            <span>
              <b>Real infrastructure</b>
              Every action changes your isolated Kubernetes workload.
            </span>
          </div>
          <div>
            <Shuffle size={15} />
            <span>
              <b>Server-drawn cascade</b>
              You cannot pick the scenario that appears.
            </span>
          </div>
          <div>
            <ShieldCheck size={15} />
            <span>
              <b>Clean decisions only</b>
              One incorrect move ends the attempt.
            </span>
          </div>
          <div>
            <Timer size={15} />
            <span>
              <b>ELO and official time</b>
              Decisions move your rating; successful runs also record your
              speed.
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.rulesCompact}>
          <span>
            <Radio size={11} /> real cluster
          </span>
          <span>
            <Shuffle size={11} /> random draw
          </span>
          <span>
            <ShieldCheck size={11} /> one shot
          </span>
        </div>
      )}

      <div className={styles.pool}>
        <span>Current ranked pool</span>
        <b>
          {loading ? "Reading scenarios…" : `${eligible.length} cascades ready`}
        </b>
      </div>

      {loadError && <p className={styles.entryError}>{loadError}</p>}

      {recent.length > 0 && (
        <section className={styles.recent}>
          <header>
            <span>
              <History size={11} /> Recent matches
            </span>
            <a href="/leaderboard">
              Full ladder <ArrowRight size={10} />
            </a>
          </header>
          <div>
            {recent.map((attempt) => {
              const won = attempt.outcome === "completed";
              return (
                <article key={attempt.id}>
                  <i className={won ? styles.matchWin : styles.matchLoss}>
                    {won ? <Check size={10} /> : <X size={10} />}
                  </i>
                  <span>
                    <b>{scenarioName(attempt.drillId)}</b>
                    <small>
                      {won
                        ? `${clock(attempt.elapsedMs)} official`
                        : `${attempt.outcome} · stage ${attempt.stageReached}`}
                    </small>
                  </span>
                  <strong
                    className={
                      attempt.ratingDelta >= 0
                        ? styles.matchGain
                        : styles.matchDrop
                    }
                  >
                    {attempt.ratingDelta >= 0 ? "+" : ""}
                    {attempt.ratingDelta}
                  </strong>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <button
        className={styles.start}
        onClick={() => act("ranked", () => startDrill(run.runId, "", "ranked"))}
        disabled={locked}
      >
        {busy === "ranked" || provisioning ? (
          <Loader2 size={15} className={styles.spin} />
        ) : (
          <Trophy size={15} />
        )}
        {provisioning ? "Preparing live workload…" : "Start ranked incident"}
      </button>

      <a className={styles.boardLink} href="/leaderboard">
        View competitive standings <ArrowRight size={12} />
      </a>
    </div>
  );
}
