"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface Viewport {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.4;
const ZOOM_STEP = 1.25;

/**
 * Pan and zoom over a fixed-size diagram.
 *
 * The chart is genuinely larger than any panel it can be shown in — the widest rank is a dozen
 * boxes across — so shrinking it to fit would make the labels unreadable, which is the failure the
 * old version had. Instead it opens fitted and the operator moves around it, the way every diagram
 * tool works: drag to pan, wheel to zoom about the cursor, and a fit control to get back.
 */
export function useViewport(contentWidth: number, contentHeight: number) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || contentWidth <= 0 || contentHeight <= 0) return;
    const { width, height } = frame.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    // Never zoom past 1: a small graph should sit at its natural size, centred, rather than being
    // blown up until four boxes fill the panel.
    const scale = Math.min(
      1,
      Math.max(
        MIN_SCALE,
        Math.min(width / contentWidth, height / contentHeight),
      ),
    );
    setViewport({
      scale,
      x: (width - contentWidth * scale) / 2,
      y: (height - contentHeight * scale) / 2,
    });
  }, [contentWidth, contentHeight]);

  // Fit on first paint and whenever the diagram's size changes (a layer filter, a search).
  useLayoutEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [fit]);

  const zoomBy = useCallback(
    (factor: number, origin?: { x: number; y: number }) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const px = origin ? origin.x - rect.left : rect.width / 2;
      const py = origin ? origin.y - rect.top : rect.height / 2;

      setViewport((v) => {
        const scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, v.scale * factor),
        );
        if (scale === v.scale) return v;
        // Keep whatever is under the cursor pinned there while the scale changes.
        const ratio = scale / v.scale;
        return {
          scale,
          x: px - (px - v.x) * ratio,
          y: py - (py - v.y) * ratio,
        };
      });
    },
    [],
  );

  // Wheel has to be a non-passive native listener: React's onWheel is passive, so preventDefault()
  // there does nothing and the page scrolls away underneath the zoom.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Left button only, and not when the press started on a node — that is a selection.
      if (event.button !== 0) return;
      if ((event.target as Element).closest("[data-flow-node]")) return;
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        ox: viewport.x,
        oy: viewport.y,
      };
      setPanning(true);
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    },
    [viewport.x, viewport.y],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setViewport((v) => ({
      ...v,
      x: drag.ox + (event.clientX - drag.x),
      y: drag.oy + (event.clientY - drag.y),
    }));
  }, []);

  const endPan = useCallback(() => {
    dragRef.current = null;
    setPanning(false);
  }, []);

  /** Bring a point in diagram space to the centre of the frame, keeping the current scale. */
  const centerOn = useCallback((x: number, y: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const { width, height } = frame.getBoundingClientRect();
    setViewport((v) => ({
      ...v,
      x: width / 2 - x * v.scale,
      y: height / 2 - y * v.scale,
    }));
  }, []);

  return {
    frameRef,
    viewport,
    panning,
    fit,
    centerOn,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
    },
  };
}
