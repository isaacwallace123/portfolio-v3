import { describe, expect, it } from "vitest";
import {
  clampScale,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  zoomAbout,
  type Viewport,
} from "./useGraphViewport";

/** Where a viewport point lands in the world the transform is drawing. */
const toWorld = (view: Viewport, px: number, py: number) => ({
  x: (px - view.x) / view.scale,
  y: (py - view.y) / view.scale,
});

describe("graph viewport zoom", () => {
  it("keeps the point under the cursor under the cursor", () => {
    // The whole contract. Zooming toward a pod should magnify that pod, not slide it off screen.
    const before = toWorld(IDENTITY, 320, 210);
    const after = zoomAbout(IDENTITY, 1.6, 320, 210);

    expect(toWorld(after, 320, 210).x).toBeCloseTo(before.x, 6);
    expect(toWorld(after, 320, 210).y).toBeCloseTo(before.y, 6);
  });

  it("holds that point across a chain of gestures from a panned view", () => {
    // Drift only shows up after several moves, which is exactly when a single-step test passes and
    // the feature still feels broken.
    let view: Viewport = { x: -140, y: 65, scale: 0.8 };
    const anchor = toWorld(view, 500, 300);

    for (const factor of [1.2, 1.2, 0.9, 1.4, 0.75])
      view = zoomAbout(view, factor, 500, 300);

    expect(toWorld(view, 500, 300).x).toBeCloseTo(anchor.x, 6);
    expect(toWorld(view, 500, 300).y).toBeCloseTo(anchor.y, 6);
  });

  it("zooms about the given point rather than the origin", () => {
    // Zooming about a corner must translate the view; a version that only wrote scale would leave
    // x and y untouched and pass a naive scale-only assertion.
    const zoomed = zoomAbout(IDENTITY, 2, 400, 240);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBe(-400);
    expect(zoomed.y).toBe(-240);
  });

  it("does not move the view at all when the scale is already clamped", () => {
    const atMax: Viewport = { x: 12, y: -30, scale: MAX_SCALE };
    // Same object back: a clamped gesture is not a state change, so it should not re-render either.
    expect(zoomAbout(atMax, 2, 100, 100)).toBe(atMax);

    const atMin: Viewport = { x: 5, y: 5, scale: MIN_SCALE };
    expect(zoomAbout(atMin, 0.5, 100, 100)).toBe(atMin);
  });

  it("clamps rather than refusing a gesture that overshoots", () => {
    // Overshooting should land on the limit, not be discarded — otherwise a fast wheel spin near
    // the boundary does nothing at all.
    const zoomed = zoomAbout(IDENTITY, 99, 0, 0);
    expect(zoomed.scale).toBe(MAX_SCALE);
    expect(zoomed).not.toBe(IDENTITY);
  });

  it("bounds the scale on both sides", () => {
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(-3)).toBe(MIN_SCALE);
    expect(clampScale(1)).toBe(1);
  });

  it("never lets the scale reach zero, which would divide the edge measurement by it", () => {
    // useClusterEdges divides screen deltas by this to get back to local space.
    expect(MIN_SCALE).toBeGreaterThan(0);
    expect(clampScale(Number.MIN_VALUE)).toBeGreaterThan(0);
  });
});
