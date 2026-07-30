"use client";

import { createElement, memo } from "react";
import { ChevronDown } from "lucide-react";
import type { ViewNode } from "../model/collapse";
import type { FlowNodeBox } from "../model/layout";
import { layerIcon } from "../model/layers";
import s from "../topology.module.css";

interface Props {
  box: FlowNodeBox<ViewNode>;
  selected: boolean;
  /** Whether this box is the focus or one step from it — everything else is dimmed. */
  related: boolean;
  /** True while something is focused, so unrelated boxes recede instead of all staying lit. */
  focusing: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Opening a group replaces it with the components it stands for. */
  onExpand: (layer: string) => void;
}

/** One box: either a collapsed layer, or a single component with its readiness. */
function FlowNodeImpl({
  box,
  selected,
  related,
  focusing,
  onSelect,
  onHover,
  onExpand,
}: Props) {
  const view = box.node;
  const { x, y, w, h } = box;
  const isGroup = view.kind === "group";
  const status = isGroup ? view.status : view.node.status;
  const label = isGroup ? view.label : view.node.label;
  const desired = isGroup ? view.desired : view.node.desired;
  const ready = isGroup ? view.ready : view.node.ready;
  const short = desired > 0 && ready < desired;

  // A group opens to show what it stands for; a component is only ever selected.
  const activate = () => (isGroup ? onExpand(view.layer) : onSelect(view.id));

  return (
    <g
      data-flow-node={view.id}
      className={s.node}
      data-layer={view.layer}
      data-group={isGroup || undefined}
      data-selected={selected || undefined}
      data-dim={focusing && !related ? "" : undefined}
      transform={`translate(${x - w / 2} ${y - h / 2})`}
      onClick={activate}
      onMouseEnter={() => onHover(view.id)}
      onMouseLeave={() => onHover(null)}
      tabIndex={0}
      role="button"
      aria-label={
        isGroup
          ? `${label}, ${view.count} components, ${status}. Activate to expand.`
          : `${label} — ${view.node.kind}, ${status}`
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      <rect className={s.nodeBox} width={w} height={h} rx={11} />
      {/* A colour bar on the leading edge reads as "which layer" without another legend lookup. */}
      <rect className={s.nodeSpine} width={4} height={h} rx={2} />

      {isGroup ? (
        <g
          className={s.nodeGlyph}
          transform={`translate(14 ${h / 2 - 17})`}
          aria-hidden="true"
        >
          {createElement(layerIcon(view.layer), { size: 13 })}
        </g>
      ) : (
        <circle
          className={s.nodeStatus}
          data-status={status}
          cx={20}
          cy={h / 2 - 7}
          r={4}
        />
      )}

      <text className={s.nodeLabel} x={32} y={h / 2 - 3}>
        {truncate(label, isGroup ? LABEL_CHARS - 3 : LABEL_CHARS)}
      </text>
      <text className={s.nodeMeta} x={32} y={h / 2 + 14}>
        {isGroup
          ? `${view.count} components`
          : truncate(view.node.kind, META_CHARS)}
        {desired > 0 && (
          <tspan className={s.nodeCount} data-short={short || undefined}>
            {`  ·  ${ready}/${desired}`}
          </tspan>
        )}
      </text>

      {isGroup && (
        <>
          {/* The worst state among the members, so a collapsed box never hides a problem. */}
          <circle
            className={s.nodeStatus}
            data-status={status}
            cx={w - 32}
            cy={h / 2}
            r={4}
          />
          <g
            className={s.nodeChevron}
            transform={`translate(${w - 24} ${h / 2 - 7})`}
            aria-hidden="true"
          >
            <ChevronDown size={14} />
          </g>
        </>
      )}

      <title>
        {isGroup
          ? `${label} — ${view.count} components. Click to expand.`
          : `${label} — ${view.node.kind}`}
      </title>
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
