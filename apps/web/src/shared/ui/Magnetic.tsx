"use client";

import { useRef } from "react";
import { prefersReducedMotion } from "@/shared/lib/prefs";

// Magnetic wrapper: the child leans a few pixels toward the cursor and springs
// back on leave. Pointer-only nicety — touch devices and reduced motion never
// see it (hover never fires; transform stays 0).
export default function Magnetic({
  children,
  strength = 0.25,
  className = "",
}: {
  children: React.ReactNode;
  /** Fraction of the cursor offset the element follows (0.15–0.35 is tasteful). */
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    el.style.transition = "transform 80ms linear";
    el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = `transform ${getComputedStyle(el).getPropertyValue("--dur-slow") || "320ms"} var(--ease-spring)`;
    el.style.transform = "translate(0, 0)";
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`inline-block will-change-transform ${className}`}
    >
      {children}
    </div>
  );
}
