import type { LeaderboardEntry } from "@/shared/api/live-client";
import { toPodium } from "../model/board";
import { PodiumSlot } from "./PodiumSlot";
import styles from "../leaderboard.module.css";

/** The top three. Reading order is 1-2-3; the champion is centred by CSS where three fit. */
export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <ol className={styles.podium}>
      {toPodium(entries).map((slot) => (
        <PodiumSlot key={slot.place} slot={slot} />
      ))}
    </ol>
  );
}
