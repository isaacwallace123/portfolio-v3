import { Medal } from "lucide-react";
import styles from "../leaderboard.module.css";

/** A rank pill, medal-tinted for the top three and neutral below them. */
export function RankBadge({ rank }: { rank: number }) {
  const medalled = rank <= 3;
  return (
    <span className={styles.badge} data-rank={medalled ? rank : "n"}>
      {medalled && <Medal size={12} />}
      {rank}
    </span>
  );
}
