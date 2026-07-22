"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/shared/lib/prefs";

// Animated stat counter: counts up with rAF once it scrolls into view.
// Reduced motion (either switch) skips straight to the final value — which is
// also what's server-rendered, so no-JS visitors see the real number too.
export default function Counter({
  to,
  suffix = "",
  duration = 900,
}: {
  to: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      to === 0 ||
      prefersReducedMotion() ||
      !("IntersectionObserver" in window)
    )
      return; // keep the SSR'd final value

    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ~--ease-out
    let raf = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        el.textContent = `${Math.round(ease(p) * to)}${suffix}`;
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          run();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, suffix, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {to}
      {suffix}
    </span>
  );
}
