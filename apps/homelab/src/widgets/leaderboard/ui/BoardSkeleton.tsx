import { stagger } from "../lib/motion";
import { PODIUM_PLACES } from "../model/board";
import styles from "../leaderboard.module.css";

/** The board's own silhouette while it loads, so the page does not resize under the reader. */
export function BoardSkeleton() {
  return (
    <div aria-hidden>
      <div className={styles.podium}>
        {PODIUM_PLACES.map((place) => (
          <div
            key={place}
            className={styles.ghost}
            data-place={place}
            style={stagger(place)}
          />
        ))}
      </div>
      <div className={styles.grid}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={styles.ghost} style={stagger(i)} />
        ))}
      </div>
    </div>
  );
}
