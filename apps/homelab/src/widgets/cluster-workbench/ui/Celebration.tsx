"use client";

import { useState } from "react";
import styles from "../workbench.module.css";

/** Purely decorative celebration for a solved drill: random confetti plus a few firework bursts.
    Generated once per mount so the randomness does not resample on every poll. */
export function Celebration() {
  const [pieces] = useState(() =>
    Array.from({ length: 90 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 1400,
      duration: 2200 + Math.random() * 2200,
      drift: Math.random() * 160 - 80,
      spin: Math.random() * 900 - 450,
      size: 5 + Math.random() * 7,
      hue: Math.floor(Math.random() * 3),
    })),
  );
  const [bursts] = useState(() =>
    Array.from({ length: 4 }, (_, i) => ({
      x: 18 + Math.random() * 64,
      y: 18 + Math.random() * 42,
      delay: i * 420 + Math.random() * 220,
      sparks: Array.from({ length: 16 }, (_, k) => ({
        angle: (k / 16) * 360 + Math.random() * 12,
        distance: 70 + Math.random() * 70,
      })),
    })),
  );

  return (
    <div className={styles.celebration} aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={styles[`c${p.hue}` as keyof typeof styles]}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      {bursts.map((b, i) => (
        <span
          key={i}
          className={styles.burst}
          style={{ left: `${b.x}%`, top: `${b.y}%` }}
        >
          {b.sparks.map((s, k) => (
            <em
              key={k}
              style={
                {
                  animationDelay: `${b.delay}ms`,
                  "--angle": `${s.angle}deg`,
                  "--dist": `${s.distance}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}
