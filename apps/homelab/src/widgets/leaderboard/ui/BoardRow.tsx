import type { CSSProperties } from "react";
import type { LeaderboardEntry } from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import { stagger } from "../lib/motion";
import { share } from "../lib/scale";
import { rankedTime } from "../model/board";
import { RankBadge } from "./RankBadge";
import styles from "../leaderboard.module.css";

export function BoardRow({
  entry,
  overall,
  index,
  fastest,
}: {
  entry: LeaderboardEntry;
  overall: boolean;
  index: number;
  fastest: number;
}) {
  const time = rankedTime(entry, overall);
  return (
    <tr
      className={entry.isYou ? styles.youRow : undefined}
      style={stagger(index)}
    >
      <td className={styles.rank}>
        <RankBadge rank={entry.rank} />
      </td>
      <td className={styles.operator}>
        <span>{entry.displayName}</span>
        {entry.isYou && <em className={styles.tag}>you</em>}
      </td>
      {overall && <td className={styles.num}>{entry.drillsSolved}</td>}
      <td className={`${styles.num} ${styles.timeCell}`}>
        <span>{clock(time)}</span>
        <i
          className={styles.bar}
          style={{ "--w": `${share(time, fastest)}%` } as CSSProperties}
        />
      </td>
      {overall && <td className={styles.num}>{clock(entry.bestMs)}</td>}
      <td
        className={`${styles.num} ${entry.missteps === 0 ? styles.clean : ""}`}
      >
        {entry.missteps}
      </td>
    </tr>
  );
}
