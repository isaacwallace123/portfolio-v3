import type { CSSProperties } from "react";

/**
 * Both motion switches the design contract requires: the OS setting and the per-site cosmetic
 * preference. CSS animations are killed globally by the same two signals; this is for the parts
 * that are driven by script and have to opt out themselves.
 */
export function lessMotion() {
  return (
    document.documentElement.hasAttribute("data-reduce-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A stagger index handed to CSS as `--i`. Delays stay in the stylesheet, so a component never
 * hardcodes a duration and reduced motion only has to be honoured in one place.
 */
export function stagger(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}
