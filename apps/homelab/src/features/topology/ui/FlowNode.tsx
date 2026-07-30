"use client";

import { memo } from "react";
import type { FlowNodeBox } from "../model/layout";
import s from "../topology.module.css";

interface Props {
  box: FlowNodeBox;
  selected: boolean;
  /** Whether this box is the focus or one step from it — everything else is dimmed. */
  related: boolean;
  /** True while something is focused, so unrelated boxes recede instead of all staying lit. */
  focusing: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/** One box in the chart: status light, name, kind, and how many replicas are actually ready. */
function FlowNodeImpl({
  box,
  selected,
  related,
  focusing,
  onSelect,
  onHover,
}: Props) {
  const { node, x, y, w, h } = box;
  const left = x - w / 2;
  const top = y - h / 2;
  const ready = node.desired > 0 && node.ready < node.desired;

  return (
    <g
      data-flow-node={node.id}
      className={s.node}
      data-layer={node.layer}
      data-selected={selected || undefined}
      data-dim={focusing && !related ? "" : undefined}
      transform={`translate(${left} ${top})`}
      onClick={() => onSelect(node.id)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${node.label} — ${node.kind}, ${node.status}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <rect className={s.nodeBox} width={w} height={h} rx={11} />
      {/* A colour bar on the leading edge reads as "which layer" without another legend lookup. */}
      <rect className={s.nodeSpine} width={4} height={h} rx={2} />
      <circle
        className={s.nodeStatus}
        data-status={node.status}
        cx={20}
        cy={h / 2 - 7}
        r={4}
      />
      {/* The name gets the full width; the kind and the replica count share the line below it, so
          nothing has to be squeezed to make room for a number that is usually two characters. */}
      <text className={s.nodeLabel} x={32} y={h / 2 - 3}>
        {truncate(node.label, LABEL_CHARS)}
      </text>
      <text className={s.nodeMeta} x={32} y={h / 2 + 14}>
        {truncate(node.kind, META_CHARS)}
        {node.desired > 0 && (
          <tspan className={s.nodeCount} data-short={ready || undefined}>
            {`  ·  ${node.ready}/${node.desired}`}
          </tspan>
        )}
      </text>
      <title>{`${node.label} — ${node.kind}`}</title>
    </g>
  );
}

// SVG text does not wrap or ellipsise, so it is cut here rather than allowed to run past the box.
// The full name is always one hover (or one inspector click) away.
const LABEL_CHARS = 21;
const META_CHARS = 18;

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export const FlowNode = memo(FlowNodeImpl);
