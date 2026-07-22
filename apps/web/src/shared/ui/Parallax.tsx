"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

// Layered depth: the child drifts vertically as the page scrolls, at a fraction
// of the scroll speed. Positive speed → moves up (foreground feel); negative →
// lags behind (background). Reduced motion → no transform.
export default function Parallax({
  children,
  className = "",
  speed = 0.15,
}: {
  children: React.ReactNode;
  className?: string;
  /** Fraction of the element's travel to offset; ~0.1–0.3 reads as tasteful depth. */
  speed?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const raw = useTransform(
    scrollYProgress,
    [0, 1],
    [`${speed * 100}%`, `${-speed * 100}%`],
  );
  const y = useSpring(raw, { stiffness: 120, damping: 30, mass: 0.5 });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div ref={ref} className={className} style={{ y }}>
      {children}
    </motion.div>
  );
}
