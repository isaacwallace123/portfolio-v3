"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

// Apple-style scroll-linked reveal: as the element crosses the lower half of the
// viewport its opacity, lift, and scale are driven CONTINUOUSLY by scroll position
// (not a one-shot toggle), so motion tracks the wheel. Reduced motion → static.
export default function ScrollReveal({
  children,
  className = "",
  y = 48,
  scaleFrom = 0.96,
  blur = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Starting vertical offset in px. */
  y?: number;
  /** Starting scale (1 = none). */
  scaleFrom?: number;
  /** Fade a blur in with the reveal. */
  blur?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // 0 when the element's top nears the viewport bottom, 1 once it's ~38% in.
  // Completing early (0.62, not 0.4) matters: the LAST element on the page can't
  // scroll high enough to reach a deep target, so a deep target would strand it
  // permanently mid-reveal (blurred). 0.62 is reachable for every element.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.95", "start 0.62"],
  });
  const p = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    mass: 0.4,
  });

  const opacity = useTransform(p, [0, 1], [0, 1]);
  const translateY = useTransform(p, [0, 1], [y, 0]);
  const scale = useTransform(p, [0, 1], [scaleFrom, 1]);
  const filter = useTransform(p, [0, 1], ["blur(8px)", "blur(0px)"]);

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{
        opacity,
        y: translateY,
        scale,
        ...(blur ? { filter } : {}),
        willChange: "transform, opacity, filter",
      }}
    >
      {children}
    </motion.div>
  );
}
