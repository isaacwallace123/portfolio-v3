import { Flame, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { RankedStanding } from "@/shared/api/live-client";
import styles from "../leaderboard.module.css";

export function RatingBoard({ entries }: { entries: RankedStanding[] }) {
  if (entries.length === 0)
    return (
      <section className={`${styles.card} ${styles.open}`}>
        <div className={styles.unclaimed}>
          <span className={styles.unclaimedMark}>
            <ShieldCheck size={16} />
          </span>
          <strong>The ladder is open</strong>
          <p>Complete the first competitive incident to establish a rating.</p>
        </div>
      </section>
    );

  return (
    <section className={`${styles.card} ${styles.ratingBoard}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Operator</th>
            <th>Division</th>
            <th className={styles.num}>Rating</th>
            <th className={styles.num}>Record</th>
            <th className={styles.num}>Streak</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr
              key={`${entry.rank}-${entry.displayName}`}
              className={entry.isYou ? styles.youRow : ""}
              style={{ "--i": index } as CSSProperties}
            >
              <td className={styles.rank}>
                <span className={styles.badge} data-rank={entry.rank}>
                  {entry.rank}
                </span>
              </td>
              <td className={styles.operator}>
                {entry.displayName}
                {entry.isYou && <em className={styles.tag}>you</em>}
              </td>
              <td>
                <span
                  className={styles.division}
                  data-division={entry.division.toLowerCase()}
                >
                  {entry.division}
                </span>
              </td>
              <td className={`${styles.num} ${styles.rating}`}>
                {entry.rating}
              </td>
              <td className={styles.num}>
                {entry.wins}–{entry.losses}
              </td>
              <td className={styles.num}>
                <span className={styles.streak}>
                  <Flame size={11} /> {entry.currentStreak}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
