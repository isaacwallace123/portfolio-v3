import styles from "../leaderboard.module.css";

/** A titled divider between the board's two halves, with a rule that draws itself in. */
export function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className={styles.sectionHead}>
      <h2>{title}</h2>
      <p>{note}</p>
    </div>
  );
}
