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
  nodes: TopologyNode[];
  /** What feeds the selected node, and what it feeds — the flowchart's answer in list form. */
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
      {selected && (
        <>
          <header className={s.inspectorHead} data-layer={selected.layer}>
            <div className={s.inspectorTags}>
              <span className={s.statusTag} data-status={selected.status}>
                <i /> {selected.status}
              </span>
              <span className={s.layerTag}>
                <LayerGlyph layer={selected.layer} />{" "}
                {layerLabel(selected.layer)}
              </span>
            </div>
            <h2>{selected.label}</h2>
            <p>{selected.kind}</p>
          </header>

          <p className={s.description}>{selected.description}</p>

          <dl className={s.metrics}>
            <div>
              <Boxes size={15} />
              <dt>Ready</dt>
              <dd data-short={selected.ready < selected.desired || undefined}>
                {selected.desired > 0
                  ? `${selected.ready}/${selected.desired}`
                  : "—"}
              </dd>
            </div>
            <div>
              <Cpu size={15} />
              <dt>CPU</dt>
              <dd>
                {selected.cpuUtilizationPct !== null
                  ? `${selected.cpuUtilizationPct}%`
                  : `${selected.cpuMillicores}m`}
              </dd>
            </div>
            <div>
              <MemoryStick size={15} />
              <dt>Memory</dt>
              <dd>
                {selected.memoryUtilizationPct !== null
                  ? `${selected.memoryUtilizationPct}%`
                  : `${selected.memoryMiB} MiB`}
              </dd>
            </div>
            <div>
              <GitPullRequest size={15} />
              <dt>GitOps</dt>
              <dd>{selected.gitOpsSync ?? "n/a"}</dd>
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
            Observed {new Date(selected.observedAt).toLocaleTimeString()}
          </p>
        </>
      )}

      <div className={s.componentList}>
        <strong>All components</strong>
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-selected={node.id === selected?.id || undefined}
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
        {items.map((node) => (
          <button
            key={node.id}
            type="button"
            data-layer={node.layer}
            onClick={() => onSelect(node.id)}
          >
            {node.label}
          </button>
        ))}
      </div>
    </div>
  );
}
