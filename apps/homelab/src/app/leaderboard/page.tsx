import type { Metadata } from "next";
import { Leaderboard } from "@/widgets/leaderboard";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Seasonless DevOps ELO standings and verified speed records from live multi-stage incident scenarios.",
  alternates: { canonical: "/leaderboard" },
};

export default function LeaderboardPage() {
  return <Leaderboard />;
}
