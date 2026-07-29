"use client";

import { useMemo } from "react";
import { summarize, PODIUM_PLACES } from "../model/board";
import { useLeaderboard } from "../model/useLeaderboard";
import { BoardSkeleton } from "./BoardSkeleton";
import { BoardTable } from "./BoardTable";
import { Podium } from "./Podium";
import { SectionHead } from "./SectionHead";
import { StatStrip } from "./StatStrip";
import styles from "../leaderboard.module.css";

export function Leaderboard() {
  const { board, error, loading } = useLeaderboard();
  const summary = useMemo(() => (board ? summarize(board) : null), [board]);

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
          Ranked runs draw a multi-stage cascade at random and time it from the
          first signal to the last recovery. Standings use each operator&apos;s
          best run of a drill, so practising one can only improve a place —
          never dilute it. Overall rank goes to breadth first: how many
          different cascades you have resolved, then how fast on average.
        </p>
      </div>

      {summary && <StatStrip summary={summary} />}
      {error && <p className={styles.error}>{error}</p>}

      <p className={styles.status} role="status">
        {loading ? "Reading the board…" : ""}
      </p>
      {loading && <BoardSkeleton />}

      {board && (
        <>
          <SectionHead
            title="Overall standings"
            note="Ranked by cascades resolved, then by average time across them."
          />
          <Podium entries={board.overall} />

          {/* The podium already carries the top three; a full table only earns its space once the
              standings run deeper than it. */}
          {board.overall.length > PODIUM_PLACES.length && (
            <BoardTable
              title="Full standings"
              note="Every ranked operator, in order."
              entries={board.overall}
              overall
            />
          )}

          <SectionHead
            title="Cascade records"
            note="The fastest ranked resolution held for each drill."
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
