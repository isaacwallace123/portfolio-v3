"use client";

import { useEffect, useState } from "react";
import { lessMotion } from "../lib/motion";

/**
 * Counts up to a value on mount. The board is about the clock, so the clock is the thing that
 * moves. Server render and reduced motion both start — and stay — at the total.
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(() =>
    typeof window === "undefined" || lessMotion() ? target : 0,
  );

  useEffect(() => {
    const reduced = lessMotion();
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (reduced) {
        setValue(target);
        return;
      }
      const progress = Math.min(1, (now - start) / duration);
      // Cubic ease-out: fast start, long settle — the entrance easing, as a number.
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
