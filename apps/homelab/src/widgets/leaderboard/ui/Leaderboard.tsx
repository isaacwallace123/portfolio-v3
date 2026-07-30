"use client";

import { PODIUM_PLACES } from "../model/board";
import { useLeaderboard } from "../model/useLeaderboard";
import { BoardSkeleton } from "./BoardSkeleton";
import { BoardTable } from "./BoardTable";
import { Podium } from "./Podium";
import { RatingBoard } from "./RatingBoard";
import { SectionHead } from "./SectionHead";
import styles from "../leaderboard.module.css";

export function Leaderboard() {
  const { board, standings, error, loading } = useLeaderboard();

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <p className="kicker">
          <i className={styles.liveDot} /> Ranked
        </p>
        <h1>
          Best homelab <em>operator</em>
        </h1>
        <p className={styles.lede}>
          The seasonless ladder measures consistent incident resolution. Every
          server-drawn cascade moves ELO; successful recoveries also keep an
          independent official time, so reliability and speed stay visible
          without becoming the same score.
        </p>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.status} role="status">
        {loading ? "Reading the board…" : ""}
      </p>
      {loading && <BoardSkeleton />}

      {board && standings && (
        <>
          <SectionHead
            title="Operator ladder"
            note="Seasonless ELO across every completed, failed, forfeited, or expired match."
          />
          <RatingBoard entries={standings} />

          <SectionHead
            title="Speed records"
            note="Successful recoveries only. Time never changes ELO."
          />
          <Podium entries={board.overall} />

          {board.overall.length > PODIUM_PLACES.length && (
            <BoardTable
              title="Overall speed"
              note="Breadth of cascades resolved, then average official time."
              entries={board.overall}
              overall
            />
          )}

          <SectionHead
            title="Cascade records"
            note="Fastest verified resolution for each live scenario."
          />
          <div className={styles.grid}>
            {board.byDrill.map((drill, i) => (
              <BoardTable
                key={drill.drillId}
                title={drill.title}
                entries={drill.entries}
                overall={false}
                index={i}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
