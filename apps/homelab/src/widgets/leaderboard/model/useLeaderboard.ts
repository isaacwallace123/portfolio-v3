"use client";

import { useEffect, useState } from "react";
import {
  fetchLeaderboard,
  type LeaderboardView,
} from "@/shared/api/live-client";

export interface LeaderboardState {
  board: LeaderboardView | null;
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

  return { board, error, loading: !board && !error };
}
