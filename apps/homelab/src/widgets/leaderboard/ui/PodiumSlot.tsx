import { Crown, Medal } from "lucide-react";
import { clock } from "@/shared/lib/format";
import { stagger } from "../lib/motion";
import { PLACE_LABEL, type PodiumSlot as Slot } from "../model/board";
import { CountClock } from "./CountClock";
import styles from "../leaderboard.module.css";

export function PodiumSlot({ slot }: { slot: Slot }) {
  const { place, entry } = slot;
  const classes = [
    styles.slot,
    entry ? "" : styles.open,
    entry?.isYou ? styles.you : "",
  ];

  return (
    <li
      className={classes.filter(Boolean).join(" ")}
      data-place={place}
      style={stagger(place)}
    >
      <span className={styles.place}>
        {place === 1 ? <Crown size={13} /> : <Medal size={13} />}
        {PLACE_LABEL[place]}
      </span>

      {entry ? (
        <>
          <strong className={styles.name}>
            {entry.displayName}
            {entry.isYou && <em className={styles.tag}>you</em>}
          </strong>
          <span className={styles.time}>
            <CountClock ms={entry.averageMs} />
          </span>
          <span className={styles.caption}>
            average across {entry.drillsSolved} cascade
            {entry.drillsSolved === 1 ? "" : "s"}
          </span>
          <dl className={styles.meta}>
            <div>
              <dt>Best</dt>
              <dd>{clock(entry.bestMs)}</dd>
            </div>
            <div>
              <dt>Missteps</dt>
              <dd>{entry.missteps}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <strong className={styles.name}>Open</strong>
          <span className={styles.time}>--:--</span>
          <span className={styles.caption}>Nobody holds this place yet.</span>
        </>
      )}
    </li>
  );
}
