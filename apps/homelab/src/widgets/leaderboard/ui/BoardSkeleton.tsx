import styles from "../leaderboard.module.css";

export function BoardSkeleton() {
  return (
    <div className={styles.boardSkeleton} aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <i key={row} />
      ))}
    </div>
  );
}
