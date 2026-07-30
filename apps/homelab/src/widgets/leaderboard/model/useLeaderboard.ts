"use client";

import { useEffect, useState } from "react";
import {
  fetchRankedStandings,
  fetchTimeStandings,
  type LeaderboardView,
  type RankedStanding,
} from "@/shared/api/live-client";

export interface LeaderboardState {
  times: LeaderboardView | null;
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
  const [times, setTimes] = useState<LeaderboardView | null>(null);
  const [standings, setStandings] = useState<RankedStanding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchTimeStandings(), fetchRankedStandings()])
      .then(([speedBoard, ratingBoard]) => {
        if (!alive) return;
        setTimes(speedBoard);
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

  return {
    times,
    standings,
    error,
    loading: (!times || !standings) && !error,
  };
}
