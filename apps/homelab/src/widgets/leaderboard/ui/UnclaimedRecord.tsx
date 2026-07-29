import { Trophy } from "lucide-react";
import styles from "../leaderboard.module.css";

/** What a board with no finishes shows. Five of these used to be five paragraphs of apology. */
export function UnclaimedRecord() {
  return (
    <div className={styles.unclaimed}>
      <span className={styles.unclaimedMark}>
        <Trophy size={16} />
      </span>
      <strong>Unclaimed</strong>
      <p>No ranked finish yet — the first one takes the record outright.</p>
    </div>
  );
}
