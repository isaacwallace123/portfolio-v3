import { Clock3, Trophy } from "lucide-react";
import type { CSSProperties } from "react";
import type { LeaderboardEntry } from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import styles from "../leaderboard.module.css";

export function TimeBoard({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0)
    return (
      <section className={`${styles.card} ${styles.open}`}>
        <div className={styles.unclaimed}>
          <span className={styles.unclaimedMark}>
            <Clock3 size={16} />
          </span>
          <strong>No official times yet</strong>
          <p>The first verified ranked recovery opens the time board.</p>
        </div>
      </section>
    );

  return (
    <section className={`${styles.card} ${styles.standingsCard}`}>
      <div
        className={styles.tableScroller}
        role="group"
        aria-label="Official recovery time standings. Scroll horizontally if needed."
        tabIndex={0}
      >
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>
            Ranked operators ordered by fastest verified recovery
          </caption>
          <thead>
            <tr>
              <th>#</th>
              <th>Operator</th>
              <th className={styles.num}>Fastest</th>
              <th className={styles.num}>Average PB</th>
              <th className={styles.num}>Scenarios</th>
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
                <td className={`${styles.num} ${styles.fastest}`}>
                  {entry.rank === 1 && <Trophy size={12} />}
                  {clock(entry.bestMs)}
                </td>
                <td className={styles.num}>{clock(entry.averageMs)}</td>
                <td className={styles.num}>{entry.drillsSolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.scrollHint}>Scroll to see the complete time board</p>
    </section>
  );
}
