import type { ReactNode } from "react";
import { Timer, Trophy, Users } from "lucide-react";
import { stagger } from "../lib/motion";
import type { BoardSummary } from "../model/board";
import styles from "../leaderboard.module.css";

function Stat({
  icon,
  value,
  label,
  index,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  index: number;
}) {
  return (
    <div className={styles.stat} style={stagger(index)}>
      <span className={styles.statIcon}>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

/** Three numbers that frame the board before it is read. */
export function StatStrip({ summary }: { summary: BoardSummary }) {
  return (
    <div className={styles.stats}>
      <Stat
        icon={<Users size={14} />}
        value={summary.operators}
        label="Operators ranked"
        index={0}
      />
      <Stat
        icon={<Trophy size={14} />}
        value={summary.claimed}
        label="Records claimed"
        index={1}
      />
      <Stat
        icon={<Timer size={14} />}
        value={summary.fastest}
        label="Fastest ranked run"
        index={2}
      />
    </div>
  );
}
