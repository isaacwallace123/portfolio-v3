"use client";

import { useEffect, useState } from "react";

// Whether a teaching animation should run.
//
// The Academy's animations are not decoration — a request moving along the path IS the explanation
// — so "reduced motion" cannot simply mean "play it faster". It means: draw the same diagram in its
// final, explained state, with the labels and measurements that the animation would have arrived
// at. Every visual takes `animate` and is required to be legible when it is false.

/** The site-wide preference toggle sets this attribute; the OS setting is the other input. */
export function motionAllowed(
  root: { getAttribute(name: string): string | null } | null,
  prefersReduced: boolean,
): boolean {
  if (prefersReduced) return false;
  return root?.getAttribute("data-reduce-motion") === null;
}

/**
 * Server-render as "no animation", then upgrade on the client.
 *
 * Starting at `false` is the deliberate choice: the reduced-motion rendering is the one that is
 * complete without JavaScript, so a learner who never gets the effect still sees a finished
 * diagram rather than an empty frame waiting for a tick that is not coming.
 */
export function useAnimationAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;

    const read = () => setAllowed(motionAllowed(root, media.matches));
    read();

    media.addEventListener("change", read);
    // The preferences boot script flips `data-reduce-motion` on <html> after hydration, so the
    // attribute has to be watched rather than read once.
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-reduce-motion"],
    });

    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);

  return allowed;
}

/**
 * A monotonic 0→1 ramp that restarts, for driving a diagram's own clock.
 *
 * Returns a fixed 1 when animation is not allowed, which is what puts every visual into its
 * settled state instead of its first frame.
 */
export function useLoopedProgress(periodMs: number, animate: boolean): number {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      setT(((now - started) % periodMs) / periodMs);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [periodMs, animate]);

  return animate ? t : 1;
}
