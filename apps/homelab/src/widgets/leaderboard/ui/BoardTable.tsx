import type { LeaderboardEntry } from "@/shared/api/live-client";
import { stagger } from "../lib/motion";
import { fastestOf } from "../model/board";
import { BoardRow } from "./BoardRow";
import { UnclaimedRecord } from "./UnclaimedRecord";
import styles from "../leaderboard.module.css";

/**
 * One board: a titled card holding either a standing or an unclaimed record. `overall` widens it —
 * the overall board ranks on cascades solved and average time, a drill board on a single record.
 */
export function BoardTable({
  title,
  note,
  entries,
  overall,
  index = 0,
}: {
  title: string;
  note?: string;
  entries: LeaderboardEntry[];
  overall: boolean;
  index?: number;
}) {
  const held = entries.length > 0;
  const fastest = fastestOf(entries, overall);

  return (
    <section
      className={`${styles.card} ${held ? "" : styles.open}`}
      style={stagger(index)}
    >
      <header className={styles.head}>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </header>
      {held ? (
        <>
          <div
            className={styles.tableScroller}
            role="group"
            aria-label={`${title} speed records. Scroll horizontally if needed.`}
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption className={styles.visuallyHidden}>
                {title} verified speed records
              </caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Operator</th>
                  {overall && <th className={styles.num}>Cascades</th>}
                  <th className={styles.num}>{overall ? "Average" : "Time"}</th>
                  {overall && <th className={styles.num}>Best</th>}
                  <th className={styles.num}>Missteps</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <BoardRow
                    key={`${entry.rank}-${entry.displayName}`}
                    entry={entry}
                    overall={overall}
                    index={i}
                    fastest={fastest}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.scrollHint}>Scroll to see the complete record</p>
        </>
      ) : (
        <UnclaimedRecord />
      )}
    </section>
  );
}
