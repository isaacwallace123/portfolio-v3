"use client";

import { MoveHorizontal } from "lucide-react";
import styles from "./visuals.module.css";

/**
 * The scroll container every diagram sits in.
 *
 * Teaching diagrams have a width below which their labels stop being readable, so on a phone they
 * scroll sideways instead of shrinking into decoration. Two things follow from that, and they are
 * the reason this is a component rather than a `<div className={styles.stage}>` repeated eleven
 * times:
 *
 * - A scrollable region has to be operable by keyboard. Without a tab stop there is no way to
 *   scroll it without a pointing device, and the right-hand half of the diagram is unreachable.
 * - It has to admit that it scrolls. A silently clipped diagram reads as a broken one.
 */
export function Stage({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div
        className={styles.stage}
        // Focusable so the arrow keys can pan it. `group` rather than `region` because these are
        // small illustrations inside a lesson, not landmarks worth listing in a rotor.
        tabIndex={0}
        role="group"
        aria-label="Diagram, scrollable horizontally"
      >
        {children}
      </div>
      <p className={styles.scrollHint} aria-hidden>
        <MoveHorizontal size={11} />
        Scroll to see the whole diagram
      </p>
    </>
  );
}
