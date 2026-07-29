import type {
  LeaderboardEntry,
  LeaderboardView,
} from "@/shared/api/live-client";

// Projects the API's leaderboard payload into the shape the board renders, the same way live-view.ts
// projects a run. The route used to forward the upstream body untouched, which made LeaderboardView
// a promise rather than a guarantee: one missing array and the page threw inside a .map().
//
// Nothing here invents a standing. Ranks are only filled in when the API left them off, and the
// order the API returned is the order the board shows — it is the side that knows the rules.

/** The upstream row. Every field is optional because the projector is what makes it not be. */
interface RawEntry {
  rank?: number;
  displayName?: string;
  isYou?: boolean;
  drillsSolved?: number;
  bestMs?: number;
  averageMs?: number;
  missteps?: number;
  achievedUtc?: string;
}

interface RawDrillBoard {
  drillId?: string;
  title?: string;
  entries?: RawEntry[];
}

export interface RawLeaderboard {
  overall?: RawEntry[];
  byDrill?: RawDrillBoard[];
}

function toEntry(raw: RawEntry, index: number): LeaderboardEntry {
  return {
    rank: Math.max(1, Math.trunc(raw.rank ?? index + 1)),
    displayName: raw.displayName?.trim() || "Anonymous operator",
    isYou: raw.isYou === true,
    drillsSolved: Math.max(0, Math.trunc(raw.drillsSolved ?? 0)),
    bestMs: Math.max(0, Math.trunc(raw.bestMs ?? 0)),
    averageMs: Math.max(0, Math.trunc(raw.averageMs ?? 0)),
    missteps: Math.max(0, Math.trunc(raw.missteps ?? 0)),
    achievedUtc: raw.achievedUtc ?? "",
  };
}

export function toLeaderboardView(raw: RawLeaderboard): LeaderboardView {
  return {
    overall: (raw.overall ?? []).map(toEntry),
    byDrill: (raw.byDrill ?? [])
      // A board with no id cannot be keyed or linked to a drill, so it is not a board.
      .filter((d): d is RawDrillBoard & { drillId: string } =>
        Boolean(d.drillId),
      )
      .map((d) => ({
        drillId: d.drillId,
        title: d.title?.trim() || d.drillId,
        entries: (d.entries ?? []).map(toEntry),
      })),
  };
}
