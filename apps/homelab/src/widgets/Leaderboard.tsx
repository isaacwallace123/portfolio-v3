"use client";

import { useEffect, useState } from "react";
import { Loader2, Medal, Trophy } from "lucide-react";
import {
  fetchLeaderboard,
  type LeaderboardEntry,
  type LeaderboardView,
} from "@/shared/api/live-client";

/** mm:ss from milliseconds, floored at zero. */
function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function Row({ entry, overall }: { entry: LeaderboardEntry; overall: boolean }) {
  return (
    <tr className={entry.isYou ? "board-you" : undefined}>
      <td className="board-rank">
        {entry.rank <= 3 ? <Medal size={13} /> : null}
        {entry.rank}
      </td>
      <td>
        {entry.displayName}
        {entry.isYou && <em>you</em>}
      </td>
      {overall && <td className="board-num">{entry.drillsSolved}</td>}
      <td className="board-num">{clock(overall ? entry.averageMs : entry.bestMs)}</td>
      {overall && <td className="board-num">{clock(entry.bestMs)}</td>}
      <td className="board-num">{entry.missteps}</td>
    </tr>
  );
}

function Board({
  title,
  note,
  entries,
  overall,
}: {
  title: string;
  note: string;
  entries: LeaderboardEntry[];
  overall: boolean;
}) {
  return (
    <section className="board-card">
      <header className="board-head">
        <h2>{title}</h2>
        <p>{note}</p>
      </header>
      {entries.length === 0 ? (
        <p className="board-empty">
          Nobody has finished a ranked run of this yet. The first one is
          uncontested.
        </p>
      ) : (
        <table className="board-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Operator</th>
              {overall && <th className="board-num">Cascades</th>}
              <th className="board-num">{overall ? "Average" : "Time"}</th>
              {overall && <th className="board-num">Best</th>}
              <th className="board-num">Missteps</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <Row key={`${e.rank}-${e.displayName}`} entry={e} overall={overall} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Leaderboard() {
  const [board, setBoard] = useState<LeaderboardView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard()
      .then((b) => alive && setBoard(b))
      .catch(
        (e: unknown) =>
          alive &&
          setError(
            e instanceof Error ? e.message : "The board is unavailable.",
          ),
      );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="board-page">
      <div className="board-heading">
        <p className="kicker">Ranked</p>
        <h1>
          Best homelab <em>operator</em>
        </h1>
        <p>
          Ranked runs draw a multi-stage cascade at random and time it from the
          first signal to the last recovery. Standings use each operator&apos;s
          best run of a drill, so practising one can only improve a place —
          never dilute it. Overall rank goes to breadth first: how many
          different cascades you have resolved, then how fast on average.
        </p>
      </div>

      {error && <p className="board-error">{error}</p>}

      {!board && !error && (
        <p className="board-empty">
          <Loader2 size={14} className="board-spin" /> Reading the board…
        </p>
      )}

      {board && (
        <>
          <Board
            title="Overall"
            note="Ranked by cascades resolved, then by average time across them."
            entries={board.overall}
            overall
          />
          <div className="board-grid">
            {board.byDrill.map((d) => (
              <Board
                key={d.drillId}
                title={d.title}
                note="Fastest ranked resolution of this cascade."
                entries={d.entries}
                overall={false}
              />
            ))}
          </div>
          {board.overall.length === 0 && (
            <p className="board-empty">
              <Trophy size={14} /> No ranked runs recorded yet. Provision a
              practice cluster and start one.
            </p>
          )}
        </>
      )}
    </main>
  );
}
