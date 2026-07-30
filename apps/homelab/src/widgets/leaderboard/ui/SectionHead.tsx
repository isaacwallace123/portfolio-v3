import styles from "../leaderboard.module.css";

/** A numbered divider keeps the long competitive record easy to scan. */
export function SectionHead({
  index,
  title,
  note,
}: {
  index: string;
  title: string;
  note: string;
}) {
  return (
    <div className={styles.sectionHead}>
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
    </div>
  );
}
