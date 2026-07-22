"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/shared/lib/prefs";

// The shared "rise" entrance (see DESIGN.md): a ~20-line IntersectionObserver
// wrapper, no library. Content is visible by default; only once JS marks the root
// (html[data-reveal-ready]) does the hidden pre-state apply — so no-JS visitors and
// reduced-motion users always see everything immediately.
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  /** Stagger, in ms — multiples of ~70ms read best. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      el.classList.add("in");
      return;
    }
    document.documentElement.setAttribute("data-reveal-ready", "");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("in");
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
