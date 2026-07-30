"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Crosshair, Minus, Plus } from "lucide-react";
import { orthogonalPath, type FlowLayout } from "../model/layout";
import { useViewport } from "../model/useViewport";
import { FlowNode } from "./FlowNode";
import s from "../topology.module.css";

interface Props {
  layout: FlowLayout;
  selectedId: string | null;
  hoveredId: string | null;
  /** Ids one hop from the focused node, in either direction. */
  neighbours: Set<string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Set by the parent when a node is picked from the list, so the canvas can bring it into view. */
  focusRequest: { id: string; nonce: number } | null;
}

function FlowChartImpl({
  layout,
  selectedId,
  hoveredId,
  neighbours,
  onSelect,
  onHover,
  focusRequest,
}: Props) {
  const {
    frameRef,
    viewport,
    panning,
    fit,
    centerOn,
    zoomIn,
    zoomOut,
    handlers,
  } = useViewport(layout.width, layout.height);

  // What to tint: the thing under the pointer, or failing that the current selection.
  const focusId = hoveredId ?? selectedId;
  // What to fade: only ever a hover. Dimming on the selection too meant the page loaded with a
  // node already picked and two thirds of the chart greyed out — the default view of an
  // architecture diagram should be the whole architecture, and focus should be something you ask
  // for by pointing at it.
  const focusing = hoveredId !== null;

  // Paths only change when the layout does — recomputing 38 of them on every hover is exactly the
  // kind of work that makes a diagram feel sticky.
  const paths = useMemo(
    () =>
      layout.edges.map((edge) => ({
        edge,
        d: orthogonalPath(edge.points),
        arrow: arrowAt(edge.points),
      })),
    [layout.edges],
  );

  // Bring a node picked from the component list into the middle of the frame. Acting only on a new
  // nonce means asking for the same node twice still recentres it, while a re-render for any other
  // reason — a poll landing, a hover — never yanks the view out from under the operator.
  const lastCentred = useRef(-1);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastCentred.current) return;
    lastCentred.current = focusRequest.nonce;
    const box = layout.nodes.find((n) => n.id === focusRequest.id);
    if (box) centerOn(box.x, box.y);
  }, [focusRequest, layout, centerOn]);

  return (
    <div className={s.canvas}>
      <div
        ref={frameRef}
        className={s.frame}
        data-panning={panning || undefined}
        {...handlers}
      >
        <svg
          className={s.svg}
          role="img"
          aria-label="Homelab infrastructure flowchart, ordered top to bottom by dependency"
        >
          <g
            transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
          >
            <g className={s.edges}>
              {paths.map(({ edge, d, arrow }) => {
                const lit = focusId === edge.source || focusId === edge.target;
                return (
                  <g
                    key={edge.id}
                    className={s.edge}
                    data-layer={edge.layer}
                    data-lit={lit || undefined}
                    data-dim={focusing && !lit ? "" : undefined}
                    // A dashed line is the physical "runs on this machine" relationship; solid
                    // lines are traffic, reconciliation, and data.
                    data-hosts={edge.kind === "hosts" || undefined}
                  >
                    <path className={s.edgeLine} d={d} />
                    <path className={s.edgeArrow} d={arrow} />
                    <title>{`${edge.source} → ${edge.target} (${edge.kind})`}</title>
                  </g>
                );
              })}
            </g>

            <g>
              {layout.nodes.map((box) => (
                <FlowNode
                  key={box.id}
                  box={box}
                  selected={selectedId === box.id}
                  related={box.id === focusId || neighbours.has(box.id)}
                  focusing={focusing}
                  onSelect={onSelect}
                  onHover={onHover}
                />
              ))}
            </g>
          </g>
        </svg>
      </div>

      <div className={s.zoom}>
        <button type="button" onClick={zoomIn} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" onClick={zoomOut} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button type="button" onClick={fit} aria-label="Fit to view">
          <Crosshair size={14} />
        </button>
      </div>
      <p className={s.hint}>Drag to pan · scroll to zoom</p>
    </div>
  );
}

/** A small filled triangle at the end of the connector, pointing into the target's top edge. */
function arrowAt(points: { x: number; y: number }[]): string {
  const tip = points[points.length - 1];
  const w = 4.5;
  const h = 7;
  return `M ${tip.x} ${tip.y} L ${tip.x - w} ${tip.y - h} L ${tip.x + w} ${tip.y - h} Z`;
}

export const FlowChart = memo(FlowChartImpl);
