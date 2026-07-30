"use client";

import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Workflow } from "lucide-react";
import type { TopologyNode } from "@/shared/api/live-client";
import {
  buildView,
  collapsibleLayers,
  groupId,
  type ViewNode,
} from "../model/collapse";
import { layoutFlow } from "../model/layout";
import { LAYERS } from "../model/layers";
import { useTopology } from "../model/useTopology";
import { FlowChart } from "./FlowChart";
import { Inspector } from "./Inspector";
import { Toolbar } from "./Toolbar";
import s from "../topology.module.css";

/**
 * The live homelab, drawn as a flowchart.
 *
 * Nodes are ranked by dependency rather than grouped by kind, so reading downward is reading the
 * direction things actually flow: the edge tunnel at the top, then the gateway, then the platform
 * controllers, then the applications they reconcile.
 *
 * It opens collapsed — one box per layer — because the full inventory cannot be drawn compactly.
 * That was measured rather than assumed: thirty-three components come out 2050px wide and 83% of
 * the connector ink runs sideways, and dagre produces the same sprawl from the same graph, so it is
 * the shape of the system rather than the layout engine. Collapsed it is 782px, eleven links, and it
 * fits a panel at full size. Open any layer to see inside it.
 *
 * The whole surface is one feature slice: the layout engine, the collapse model, the polling and the
 * viewport all live under `features/topology`, and the route is a shell that renders this.
 */
export function TopologyBoard() {
  const { topology, error } = useTopology();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);

  const nodes = useMemo(() => topology?.nodes ?? [], [topology]);
  const edges = useMemo(() => topology?.edges ?? [], [topology]);
  const needle = query.trim().toLowerCase();

  const matches = useCallback(
    (node: TopologyNode) =>
      node.label.toLowerCase().includes(needle) ||
      node.kind.toLowerCase().includes(needle) ||
      node.id.toLowerCase().includes(needle),
    [needle],
  );

  // Searching opens whatever it finds. Leaving the match inside a collapsed box would be the one
  // case where the summary hides the answer you asked for by name.
  const openLayers = useMemo(() => {
    if (needle === "") return expanded;
    const found = new Set(expanded);
    for (const node of nodes) if (matches(node)) found.add(node.layer);
    return found;
  }, [expanded, needle, nodes, matches]);

  const view = useMemo(
    () => buildView(nodes, edges, openLayers),
    [nodes, edges, openLayers],
  );

  // A search narrows to the components that matched, plus the groups that stayed shut.
  const visible = useMemo(() => {
    if (needle === "") return view.nodes;
    return view.nodes.filter((n) => n.kind === "group" || matches(n.node));
  }, [view.nodes, needle, matches]);

  const layout = useMemo(
    () => layoutFlow(visible, view.edges),
    [visible, view.edges],
  );

  // Adjacency over the *drawn* graph, so highlighting matches what is actually on screen.
  const adjacency = useMemo(() => {
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    };
    for (const e of view.edges) {
      push(down, e.source, e.target);
      push(up, e.target, e.source);
      // A merged pair feeds both ways, so each end is upstream of the other.
      if (e.bidirectional) {
        push(down, e.target, e.source);
        push(up, e.source, e.target);
      }
    }
    return { up, down };
  }, [view.edges]);

  const byId = useMemo(
    () => new Map(view.nodes.map((n) => [n.id, n])),
    [view.nodes],
  );

  const selected: ViewNode | undefined =
    (selectedId ? byId.get(selectedId) : undefined) ?? layout.nodes[0]?.node;

  const resolve = useCallback(
    (ids: string[] | undefined): ViewNode[] =>
      (ids ?? []).flatMap((id) => {
        const node = byId.get(id);
        return node ? [node] : [];
      }),
    [byId],
  );

  const focusId = hoveredId ?? selected?.id ?? null;
  const neighbours = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set([
      ...(adjacency.up.get(focusId) ?? []),
      ...(adjacency.down.get(focusId) ?? []),
    ]);
  }, [focusId, adjacency]);

  const toggleLayer = useCallback((layer: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }, []);

  const expandLayer = useCallback((layer: string) => {
    setExpanded((prev) => new Set(prev).add(layer));
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    setSelectedId(null);
  }, []);

  // Picking from the list also moves the canvas, and opens the layer if the component is inside a
  // box that is still shut — otherwise the selection lands on something not drawn.
  const selectFromList = useCallback(
    (id: string) => {
      const layer = nodes.find((n) => n.id === id)?.layer;
      if (layer && !byId.has(id))
        setExpanded((prev) => new Set(prev).add(layer));
      setSelectedId(id);
      setFocusRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [nodes, byId],
  );

  const selectGroup = useCallback((layer: string) => {
    setSelectedId(groupId(layer));
    setFocusRequest((prev) => ({
      id: groupId(layer),
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  return (
    <main className={s.page}>
      <header className={s.heading}>
        <p className={s.kicker}>
          <Workflow size={14} /> Sanitized live architecture
        </p>
        <h1>
          The whole homelab, <em>as a flowchart.</em>
        </h1>
        <p className={s.lede}>
          Every box is read live from the Kubernetes API and ranked by what it
          depends on, so traffic and control flow downward: compute, the
          platform controllers, the gateway and data tiers, then the
          applications they run. Open any layer to see the components inside it.
        </p>
      </header>

      <section className={s.workbench}>
        <div className={s.panel}>
          <Toolbar
            live={topology !== null}
            query={query}
            onQuery={setQuery}
            expanded={openLayers}
            onToggleLayer={toggleLayer}
            onCollapseAll={collapseAll}
            collapsible={collapsibleLayers(nodes)}
            shown={layout.nodes.length}
            total={nodes.length}
          />

          {topology === null ? (
            <div className={s.loading}>
              <RefreshCw className={s.spin} size={22} />
              <span>{error ?? "Reading sanitized Kubernetes inventory…"}</span>
            </div>
          ) : layout.nodes.length === 0 ? (
            <div className={s.loading}>
              <span>Nothing matches that search.</span>
            </div>
          ) : (
            <FlowChart
              layout={layout}
              selectedId={selected?.id ?? null}
              hoveredId={hoveredId}
              neighbours={neighbours}
              onSelect={setSelectedId}
              onHover={setHoveredId}
              onExpand={expandLayer}
              focusRequest={focusRequest}
            />
          )}

          <div className={s.legend}>
            {LAYERS.map(({ id, label, icon: Icon }) => (
              <span key={id} data-layer={id}>
                <Icon size={12} /> {label}
              </span>
            ))}
            <span className={s.legendHosts}>
              <i /> runs on
            </span>
          </div>
        </div>

        <Inspector
          selected={selected}
          nodes={nodes}
          upstream={resolve(adjacency.up.get(selected?.id ?? ""))}
          downstream={resolve(adjacency.down.get(selected?.id ?? ""))}
          onSelect={selectFromList}
          onSelectGroup={selectGroup}
          onExpand={expandLayer}
        />
      </section>

      {topology && (
        <p className={s.source}>
          {topology.source} Observed{" "}
          {new Date(topology.observedAt).toLocaleString()}.
        </p>
      )}
    </main>
  );
}
