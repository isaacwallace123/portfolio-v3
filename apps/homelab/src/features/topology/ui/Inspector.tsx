"use client";

import { createElement } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  Clock,
  Cpu,
  GitPullRequest,
  MemoryStick,
} from "lucide-react";
import type { TopologyNode } from "@/shared/api/live-client";
import type { ViewNode } from "../model/collapse";
import { layerIcon, layerLabel } from "../model/layers";
import s from "../topology.module.css";

/** Resolves the layer's glyph through createElement, so no component identity is minted mid-render. */
function LayerGlyph({ layer, size = 12 }: { layer: string; size?: number }) {
  return createElement(layerIcon(layer), { size });
}

interface Props {
  selected: ViewNode | undefined;
  /** The whole inventory, collapsed or not — this list is always complete. */
  nodes: TopologyNode[];
  /** What feeds the selection, and what it feeds, as currently drawn. */
  upstream: ViewNode[];
  downstream: ViewNode[];
  onSelect: (id: string) => void;
  onSelectGroup: (layer: string) => void;
  onExpand: (layer: string) => void;
}

export function Inspector({
  selected,
  nodes,
  upstream,
  downstream,
  onSelect,
  onSelectGroup,
  onExpand,
}: Props) {
  return (
    <aside className={s.inspector}>
      {selected?.kind === "group" && (
        <>
          <header className={s.inspectorHead} data-layer={selected.layer}>
            <div className={s.inspectorTags}>
              <span className={s.statusTag} data-status={selected.status}>
                <i /> {selected.status}
              </span>
              <span className={s.layerTag}>
                <LayerGlyph layer={selected.layer} /> Layer
              </span>
            </div>
            <h2>{selected.label}</h2>
            <p>
              {selected.count} components · {selected.ready}/{selected.desired}{" "}
              ready
            </p>
          </header>

          <button
            type="button"
            className={s.expandButton}
            onClick={() => onExpand(selected.layer)}
          >
            <ChevronDown size={14} /> Open this layer on the chart
          </button>

          <Relations
            title="Depends on"
            icon={<ArrowUpRight size={12} />}
            items={upstream}
            onSelect={onSelect}
            onSelectGroup={onSelectGroup}
          />
          <Relations
            title="Feeds"
            icon={<ArrowDownRight size={12} />}
            items={downstream}
            onSelect={onSelect}
            onSelectGroup={onSelectGroup}
          />

          <div className={s.memberList}>
            <strong>Inside this layer</strong>
            {selected.members.map((node) => (
              <button
                key={node.id}
                type="button"
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
        </>
      )}

      {selected?.kind === "component" && (
        <ComponentDetail
          node={selected.node}
          upstream={upstream}
          downstream={downstream}
          onSelect={onSelect}
          onSelectGroup={onSelectGroup}
        />
      )}

      <div className={s.componentList}>
        <strong>All components</strong>
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-selected={
              (selected?.kind === "component" && selected.id === node.id) ||
              undefined
            }
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
  onSelectGroup,
}: {
  node: TopologyNode;
  upstream: ViewNode[];
  downstream: ViewNode[];
  onSelect: (id: string) => void;
  onSelectGroup: (layer: string) => void;
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
        onSelectGroup={onSelectGroup}
      />
      <Relations
        title="Feeds"
        icon={<ArrowDownRight size={12} />}
        items={downstream}
        onSelect={onSelect}
        onSelectGroup={onSelectGroup}
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
  onSelectGroup,
}: {
  title: string;
  icon: React.ReactNode;
  items: ViewNode[];
  onSelect: (id: string) => void;
  onSelectGroup: (layer: string) => void;
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
            data-group={item.kind === "group" || undefined}
            onClick={() =>
              item.kind === "group"
                ? onSelectGroup(item.layer)
                : onSelect(item.id)
            }
          >
            {item.kind === "group"
              ? `${item.label} ×${item.count}`
              : item.node.label}
          </button>
        ))}
      </div>
    </div>
  );
}
