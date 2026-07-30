"use client";

import { memo } from "react";
import type { MemberBox } from "../model/grouped";
import s from "../topology.module.css";

interface Props {
  member: MemberBox;
  selected: boolean;
  /** The focus itself, or one hop from it. */
  related: boolean;
  /** True while something is focused, so everything unrelated recedes. */
  focusing: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/** One component inside its layer container: status light, name, kind, and replicas ready. */
function MemberNodeImpl({
  member,
  selected,
  related,
  focusing,
  onSelect,
  onHover,
}: Props) {
  const { node, x, y, w, h } = member;
  const short = node.desired > 0 && node.ready < node.desired;

  return (
    <g
      data-flow-node={node.id}
      className={s.member}
      data-layer={node.layer}
      data-selected={selected || undefined}
      data-dim={focusing && !related ? "" : undefined}
      transform={`translate(${x} ${y})`}
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
      <rect className={s.memberBox} width={w} height={h} rx={9} />
      <rect className={s.memberSpine} width={3} height={h} rx={1.5} />
      <circle
        className={s.memberStatus}
        data-status={node.status}
        cx={18}
        cy={h / 2 - 6}
        r={3.5}
      />
      <text className={s.memberLabel} x={29} y={h / 2 - 2}>
        {truncate(node.label, 19)}
      </text>
      <text className={s.memberMeta} x={29} y={h / 2 + 13}>
        {truncate(node.kind, 16)}
        {node.desired > 0 && (
          <tspan className={s.memberCount} data-short={short || undefined}>
            {`  ·  ${node.ready}/${node.desired}`}
          </tspan>
        )}
      </text>
      <title>{`${node.label} — ${node.kind}`}</title>
    </g>
  );
}

// SVG text neither wraps nor ellipsises, so it is cut rather than allowed to run past the box.
const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export const MemberNode = memo(MemberNodeImpl);
