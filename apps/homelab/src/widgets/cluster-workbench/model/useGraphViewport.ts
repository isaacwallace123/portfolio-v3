"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.5;
/** One press of a zoom button. Small enough to feel like a nudge, large enough to be worth it. */
const BUTTON_STEP = 1.25;

/**
 * A press that moves less than this was a click on a node, not a drag of the canvas.
 *
 * Every node is a button, so without a threshold there is no way to both select a pod and drag the
 * view from on top of one — the pointer would have to find empty background first, which on a busy
 * graph is most of the problem.
 */
const DRAG_THRESHOLD_PX = 4;

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export const IDENTITY: Viewport = { x: 0, y: 0, scale: 1 };

export const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/**
 * Zoom about a point in viewport coordinates, keeping whatever is under that point under it.
 *
 * Pure, and separated from the hook, because this is the part that is wrong in every hand-rolled
 * pan-and-zoom: it is easy to write a version that scales correctly and drifts, and drift is only
 * obvious after several gestures. The invariant worth holding is the one the tests state — the
 * world point under the cursor before the zoom is under the cursor after it.
 */
export function zoomAbout(
  view: Viewport,
  factor: number,
  pointX: number,
  pointY: number,
): Viewport {
  const scale = clampScale(view.scale * factor);
  // At the clamp the view must not move at all; returning the same object also lets callers skip
  // a pointless render.
  if (scale === view.scale) return view;
  const ratio = scale / view.scale;
  return {
    x: pointX - (pointX - view.x) * ratio,
    y: pointY - (pointY - view.y) * ratio,
    scale,
  };
}

/**
 * Pan and zoom for the cluster graph.
 *
 * The graph outgrew its frame: a scaled-out gateway and a handful of checkout replicas do not fit
 * on one screen, and the canvas only scrolled, so the parts that mattered during an incident were
 * the parts you could not see. This makes the view something the operator moves rather than
 * something the layout decides for them.
 *
 * The transform lives here rather than on the scroll container because the edges are measured, not
 * declared: the curves between cards are computed from real boxes, so whatever moves the cards has
 * to be something the measurement can divide back out. A CSS transform on one wrapper is exactly
 * that — see useClusterEdges, which takes the scale and converts screen deltas back to local space.
 */
export function useGraphViewport() {
  const [view, setView] = useState<Viewport>(IDENTITY);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Handlers read the live value rather than the render's copy: a wheel event mid-gesture must
  // compose onto where the view actually is, not where it was when the listener was created.
  // `apply` below is the only thing that ever moves the view, and it writes both, so this needs no
  // syncing from render.
  const viewRef = useRef(view);

  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);
  // Survives past pointerup so the click that follows a drag can be swallowed.
  const dragged = useRef(false);

  const apply = useCallback((next: Viewport) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const zoomAt = useCallback(
    (factor: number, pointX: number, pointY: number) => {
      const next = zoomAbout(viewRef.current, factor, pointX, pointY);
      if (next !== viewRef.current) apply(next);
    },
    [apply],
  );

  /** Zoom about the middle of the frame — what a button press should do, having no cursor. */
  const zoomByStep = useCallback(
    (factor: number) => {
      const box = viewportRef.current?.getBoundingClientRect();
      zoomAt(factor, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2);
    },
    [zoomAt],
  );

  const zoomIn = useCallback(() => zoomByStep(BUTTON_STEP), [zoomByStep]);
  const zoomOut = useCallback(() => zoomByStep(1 / BUTTON_STEP), [zoomByStep]);
  const reset = useCallback(() => apply(IDENTITY), [apply]);

  // Wheel is bound natively because React's synthetic wheel listener is passive, and a passive
  // listener cannot preventDefault — the page would scroll behind the zoom.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      // Trackpads report small deltas and mice report large ones; exponentiating keeps a single
      // rule for both and makes the zoom feel proportional rather than stepped.
      zoomAt(
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - box.left,
        event.clientY - box.top,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    // Primary button only: right-click belongs to the browser, and middle-click to the OS.
    if (event.button !== 0) return;
    const current = viewRef.current;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      dragging: false,
    };
    dragged.current = false;
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;

      if (!active.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        active.dragging = true;
        dragged.current = true;
        // Captured only once the gesture is definitely a pan, so a plain click on a node still
        // delivers its own click to the node.
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      apply({
        x: active.originX + dx,
        y: active.originY + dy,
        scale: viewRef.current.scale,
      });
    },
    [apply],
  );

  const endGesture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (
      active.dragging &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    gesture.current = null;
  }, []);

  /** Swallow the click that a drag leaves behind, so panning off a pod does not select it. */
  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    view,
    viewportRef,
    /** Read at measure time, so edge curves can be converted out of scaled screen space. */
    getScale: useCallback(() => viewRef.current.scale, []),
    zoomIn,
    zoomOut,
    reset,
    moved: view.x !== 0 || view.y !== 0 || view.scale !== 1,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
      onClickCapture,
    },
  };
}
