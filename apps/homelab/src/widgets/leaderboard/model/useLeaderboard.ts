"use client";

import { useEffect, useState } from "react";
import {
  fetchLeaderboard,
  fetchRankedStandings,
  type LeaderboardView,
  type RankedStanding,
} from "@/shared/api/live-client";

export interface LeaderboardState {
  board: LeaderboardView | null;
  standings: RankedStanding[] | null;
  error: string | null;
  loading: boolean;
}

/**
 * The board, read once on mount. Standings only move when somebody finishes a ranked run, so this
 * does not poll — a visitor watching the page is watching their own result arrive, and that arrives
 * with a navigation.
 */
export function useLeaderboard(): LeaderboardState {
  const [board, setBoard] = useState<LeaderboardView | null>(null);
  const [standings, setStandings] = useState<RankedStanding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchLeaderboard(), fetchRankedStandings()])
      .then(([speedBoard, ratingBoard]) => {
        if (!alive) return;
        setBoard(speedBoard);
        setStandings(ratingBoard);
      })
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

  return { board, standings, error, loading: (!board || !standings) && !error };
}
