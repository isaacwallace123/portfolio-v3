import type {
  LeaderboardEntry,
  LeaderboardView,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";

/** How many places the podium stands, and therefore how deep the summary reads. */
export const PODIUM_PLACES = [1, 2, 3] as const;
export type Place = (typeof PODIUM_PLACES)[number];

export const PLACE_LABEL: Record<Place, string> = {
  1: "Champion",
  2: "Runner-up",
  3: "Third",
};

/** One podium position — held by an operator, or open. Open places are rendered, not skipped: an
 *  uncontested board should still read as a board rather than as a gap. */
export interface PodiumSlot {
  place: Place;
  entry: LeaderboardEntry | null;
}

export function toPodium(entries: LeaderboardEntry[]): PodiumSlot[] {
  return PODIUM_PLACES.map((place) => ({
    place,
    entry: entries[place - 1] ?? null,
  }));
}

export interface BoardSummary {
  /** How many operators hold a place at all. */
  operators: string;
  /** Cascades with a record set, over cascades that exist. */
  claimed: string;
  /** The single fastest ranked run anyone has recorded. */
  fastest: string;
}

export function summarize(board: LeaderboardView): BoardSummary {
  const claimed = board.byDrill.filter((d) => d.entries.length > 0).length;
  const times = board.overall.map((e) => e.bestMs).filter(Boolean);
  return {
    operators: String(board.overall.length),
    claimed: `${claimed}/${board.byDrill.length}`,
    fastest: times.length ? clock(Math.min(...times)) : "--:--",
  };
}

/** The time a row is ranked on: an average across cascades overall, a single record per drill. */
export function rankedTime(entry: LeaderboardEntry, overall: boolean): number {
  return overall ? entry.averageMs : entry.bestMs;
}

/** The best time on a board — what every bar on it is drawn relative to. */
export function fastestOf(
  entries: LeaderboardEntry[],
  overall: boolean,
): number {
  if (entries.length === 0) return 0;
  return Math.min(...entries.map((e) => rankedTime(e, overall)));
}
