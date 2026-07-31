"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FLOWS } from "./topology";

export interface EdgePath {
  id: string;
  d: string;
}

/**
 * Measures the graph's edges from the rendered card boxes, so the curves stay correct at any width
 * and for any replica count. Cards register themselves under a "service:pod" key; every card of an
 * upstream service is joined to every card of the downstream one, which is what per-request load
 * balancing actually looks like.
 *
 * Everything is measured against the world element — the one the pan/zoom transform is applied to —
 * and the paths are emitted in its local coordinates, because the SVG they end up in is inside that
 * same transform. getBoundingClientRect reports post-transform screen boxes, so a zoomed graph
 * would otherwise scale its curves twice: once by the numbers and again by the transform. Dividing
 * the screen deltas by the current scale converts them back to the space the SVG draws in.
 *
 * `deps` should change whenever the set of cards does — the layout is re-measured then, and on any
 * resize of the world or the window.
 */
export function useClusterEdges(deps: unknown[], getScale: () => number) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [paths, setPaths] = useState<EdgePath[]>([]);

  const measure = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const base = world.getBoundingClientRect();
    // A zero scale would divide the layout into infinities; the viewport clamps well above it, but
    // this is measurement code and a NaN path silently blanks every edge.
    const scale = getScale() || 1;
    const next: EdgePath[] = [];

    const curve = (from: DOMRect, to: DOMRect, id: string) => {
      const x1 = (from.right - base.left) / scale;
      const y1 = (from.top + from.height / 2 - base.top) / scale;
      const x2 = (to.left - base.left) / scale;
      const y2 = (to.top + to.height / 2 - base.top) / scale;
      const dx = Math.max(24, (x2 - x1) * 0.55);
      next.push({
        id,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
    };

    const cardsOf = (svc: string) =>
      Object.entries(cardRefs.current).filter(
        ([k, el]) => el && k.startsWith(`${svc}:`),
      );

    for (const [from, to] of FLOWS)
      for (const [sk, sel] of cardsOf(from))
        for (const [tk, tel] of cardsOf(to))
          curve(
            sel!.getBoundingClientRect(),
            tel!.getBoundingClientRect(),
            `${sk}->${tk}`,
          );

    setPaths(next);
  }, [getScale]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (worldRef.current) ro.observe(worldRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { worldRef, cardRefs, paths };
}
