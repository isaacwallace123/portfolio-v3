"use client";

import styles from "../workbench.module.css";

/** A line chart of real measured samples — a trend, not a dashboard. */
export function Spark({
  series,
  label,
  unit,
}: {
  series: number[];
  label: string;
  unit: string;
}) {
  const max = Math.max(1, ...series);
  const last = series.at(-1) ?? 0;
  const w = 260;
  const h = 40;
  const d =
    series.length < 2
      ? ""
      : series
          .map((v, i) => {
            const x = (i / (series.length - 1)) * w;
            const y = h - (v / max) * (h - 4) - 2;
            return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(" ");

  return (
    <div className={styles.spark}>
      <div className={styles.sparkTop}>
        <span>{label}</span>
        <b>
          {last}
          {unit}
        </b>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {d && (
          <>
            <path
              d={`${d} L ${w} ${h} L 0 ${h} Z`}
              className={styles.sparkFill}
            />
            <path d={d} className={styles.sparkLine} />
          </>
        )}
      </svg>
      <small>
        peak {max}
        {unit} · {series.length} samples
      </small>
    </div>
  );
}

/** Purely decorative celebration for a solved drill: random confetti plus a few firework bursts.
    Generated once per mount so the randomness does not resample on every poll. */
