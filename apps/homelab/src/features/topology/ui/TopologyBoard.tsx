"use client";

import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Workflow } from "lucide-react";
import type { TopologyNode } from "@/shared/api/live-client";
import { layoutGrouped } from "../model/grouped";
import { LAYERS } from "../model/layers";
import { useTopology } from "../model/useTopology";
import { GroupedMap } from "./GroupedMap";
import { Inspector } from "./Inspector";
import { Toolbar } from "./Toolbar";
import s from "../topology.module.css";

/**
 * The live homelab, grouped by layer.
 *
 * Every component is drawn, inside a container for the layer it belongs to. That arrangement was
 * arrived at by measurement rather than taste: giving each component its own rank in a layered
 * flowchart produced a 2050px canvas with 83% of the connector ink running sideways and one edge in
 * thirty-eight a clean vertical drop, and dagre reproduced the same sprawl from the same graph. The
 * limit is the shape of the system — a gateway feeding eight applications needs eight lines wherever
 * the boxes go. Enclosure does what coordinates could not: the eye groups by container, and the map
 * lands at 1306×900, which a panel shows at nearly full size.
 *
 * Connectors stay coarse at rest — one per pair of layers — and the component's own links are drawn
 * when you point at it.
 */
export function TopologyBoard() {
  const { topology, error } = useTopology();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showAllLinks, setShowAllLinks] = useState(false);
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

  // A search narrows the map to what matched; the containers that still hold something stay.
  const visible = useMemo(
    () => (needle === "" ? nodes : nodes.filter(matches)),
    [nodes, needle, matches],
  );

  const layout = useMemo(() => layoutGrouped(visible, edges), [visible, edges]);

  // Adjacency over the component graph, which is what a hover traces.
  const adjacency = useMemo(() => {
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, v: string) => {
      const list = m.get(k);
      if (list) list.push(v);
      else m.set(k, [v]);
    };
    for (const e of edges) {
      if (e.source === e.target) continue;
      push(down, e.source, e.target);
      push(up, e.target, e.source);
    }
    return { up, down };
  }, [edges]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const selected = selectedId ? byId.get(selectedId) : undefined;

  const resolve = useCallback(
    (ids: string[] | undefined): TopologyNode[] =>
      (ids ?? []).flatMap((id) => {
        const node = byId.get(id);
        return node ? [node] : [];
      }),
    [byId],
  );

  const focusId = hoveredId ?? selectedId;
  const neighbours = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set([
      ...(adjacency.up.get(focusId) ?? []),
      ...(adjacency.down.get(focusId) ?? []),
    ]);
  }, [focusId, adjacency]);

  // Picking from the list also brings the box into view, since the map is larger than the panel.
  const selectFromList = useCallback((id: string) => {
    setSelectedId(id);
    setFocusRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  return (
    <main className={s.page}>
      <header className={s.heading}>
        <p className={s.kicker}>
          <Workflow size={14} /> Sanitized live architecture
        </p>
        <h1>
          The whole homelab, <em>grouped by layer.</em>
        </h1>
        <p className={s.lede}>
          Every box is a real workload read from the Kubernetes API, sitting in
          the layer it belongs to — compute, the platform controllers, the
          network edge, storage, observability, and the applications they all
          carry. Point at anything to trace what it depends on and what depends
          on it.
        </p>
      </header>

      <section className={s.workbench}>
        <div className={s.panel}>
          <Toolbar
            live={topology !== null}
            query={query}
            onQuery={setQuery}
            showAllLinks={showAllLinks}
            onToggleLinks={() => setShowAllLinks((v) => !v)}
            shown={layout.members.length}
            total={nodes.length}
          />

          {topology === null ? (
            <div className={s.loading}>
              <RefreshCw className={s.spin} size={22} />
              <span>{error ?? "Reading sanitized Kubernetes inventory…"}</span>
            </div>
          ) : layout.members.length === 0 ? (
            <div className={s.loading}>
              <span>Nothing matches that search.</span>
            </div>
          ) : (
            <GroupedMap
              layout={layout}
              selectedId={selectedId}
              hoveredId={hoveredId}
              neighbours={neighbours}
              showAllLinks={showAllLinks}
              onSelect={setSelectedId}
              onHover={setHoveredId}
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
          upstream={resolve(adjacency.up.get(selectedId ?? ""))}
          downstream={resolve(adjacency.down.get(selectedId ?? ""))}
          onSelect={selectFromList}
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
