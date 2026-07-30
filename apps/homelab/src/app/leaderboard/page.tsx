import type { Metadata } from "next";
import { Leaderboard } from "@/widgets/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Ranked standings across the multi-stage incident drills: how many different cascades each operator has resolved, and how fast they resolved them.",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardPage() {
  return <Leaderboard />;
}
