"use client";

import { createElement } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Clock,
  Cpu,
  GitPullRequest,
  MemoryStick,
} from "lucide-react";
import type { TopologyNode } from "@/shared/api/live-client";
import { layerIcon, layerLabel } from "../model/layers";
import s from "../topology.module.css";

/** Resolves the layer's glyph through createElement, so no component identity is minted mid-render. */
function LayerGlyph({ layer, size = 12 }: { layer: string; size?: number }) {
  return createElement(layerIcon(layer), { size });
}

interface Props {
  selected: TopologyNode | undefined;
  /** The whole inventory — this list is always complete, whatever the map is showing. */
  nodes: TopologyNode[];
  /** What feeds the selection, and what it feeds. */
  upstream: TopologyNode[];
  downstream: TopologyNode[];
  onSelect: (id: string) => void;
}

export function Inspector({
  selected,
  nodes,
  upstream,
  downstream,
  onSelect,
}: Props) {
  return (
    <aside className={s.inspector}>
      {selected ? (
        <ComponentDetail
          node={selected}
          upstream={upstream}
          downstream={downstream}
          onSelect={onSelect}
        />
      ) : (
        <p className={s.placeholder}>
          Point at a component on the map, or pick one below, to see its live
          state and what sits on either side of it.
        </p>
      )}

      <div className={s.componentList}>
        <strong>All components</strong>
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-selected={selected?.id === node.id || undefined}
            onClick={() => onSelect(node.id)}
          >
            <i className={s.listDot} data-status={node.status} />
            <span>
              <b>{node.label}</b>
              <small>{node.kind}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ComponentDetail({
  node,
  upstream,
  downstream,
  onSelect,
}: {
  node: TopologyNode;
  upstream: TopologyNode[];
  downstream: TopologyNode[];
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <header className={s.inspectorHead} data-layer={node.layer}>
        <div className={s.inspectorTags}>
          <span className={s.statusTag} data-status={node.status}>
            <i /> {node.status}
          </span>
          <span className={s.layerTag}>
            <LayerGlyph layer={node.layer} /> {layerLabel(node.layer)}
          </span>
        </div>
        <h2>{node.label}</h2>
        <p>{node.kind}</p>
      </header>

      <p className={s.description}>{node.description}</p>

      <dl className={s.metrics}>
        <div>
          <Boxes size={15} />
          <dt>Ready</dt>
          <dd data-short={node.ready < node.desired || undefined}>
            {node.desired > 0 ? `${node.ready}/${node.desired}` : "—"}
          </dd>
        </div>
        <div>
          <Cpu size={15} />
          <dt>CPU</dt>
          <dd>
            {node.cpuUtilizationPct !== null
              ? `${node.cpuUtilizationPct}%`
              : `${node.cpuMillicores}m`}
          </dd>
        </div>
        <div>
          <MemoryStick size={15} />
          <dt>Memory</dt>
          <dd>
            {node.memoryUtilizationPct !== null
              ? `${node.memoryUtilizationPct}%`
              : `${node.memoryMiB} MiB`}
          </dd>
        </div>
        <div>
          <GitPullRequest size={15} />
          <dt>GitOps</dt>
          <dd>{node.gitOpsSync ?? "n/a"}</dd>
        </div>
      </dl>

      <Relations
        title="Depends on"
        icon={<ArrowUpRight size={12} />}
        items={upstream}
        onSelect={onSelect}
      />
      <Relations
        title="Feeds"
        icon={<ArrowDownRight size={12} />}
        items={downstream}
        onSelect={onSelect}
      />

      <p className={s.observed}>
        <Clock size={13} />
        Observed {new Date(node.observedAt).toLocaleTimeString()}
      </p>
    </>
  );
}

function Relations({
  title,
  icon,
  items,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  items: TopologyNode[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className={s.relations}>
      <strong>
        {icon} {title}
      </strong>
      <div>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-layer={item.layer}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
