"use client";

import { Minus, Plus, Scan } from "lucide-react";
import styles from "../workbench.module.css";

/**
 * Zoom for people who are not going to discover the scroll wheel, and a way back for anyone who has
 * panned the graph somewhere they cannot read.
 *
 * Reset only appears once the view has actually moved: an always-present button to undo nothing is
 * one more thing to read on a surface that is already dense during an incident.
 */
export function GraphZoomControls({
  scale,
  moved,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  moved: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className={styles.zoomControls}>
      <button
        type="button"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus size={14} />
      </button>
      {/* Not a button: it is the readout that tells you what the other three did. */}
      <span aria-hidden="true">{Math.round(scale * 100)}%</span>
      <button
        type="button"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus size={14} />
      </button>
      {moved && (
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset the view"
          title="Reset the view"
        >
          <Scan size={13} />
        </button>
      )}
    </div>
  );
}
