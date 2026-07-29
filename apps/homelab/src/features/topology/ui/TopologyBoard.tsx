"use client";

import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Workflow } from "lucide-react";
import type { TopologyNode } from "@/shared/api/live-client";
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
 * controllers, then the applications they reconcile. Colour still carries the layer; position now
 * carries the architecture.
 *
 * The whole surface is one feature slice: the layout engine, the polling, the viewport, and the
 * pieces that draw it all live under `features/topology`, and the route is a shell that renders
 * this. Nothing about reading the graph is knowledge the route has to hold.
 */
export function TopologyBoard() {
  const { topology, error } = useTopology();
  const [selectedId, setSelectedId] = useState<string | null>("homeops");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [layer, setLayer] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);

  const nodes = useMemo(() => topology?.nodes ?? [], [topology]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return nodes.filter((node) => {
      const inLayer = layer === "all" || node.layer === layer;
      const matches =
        needle === "" ||
        node.label.toLowerCase().includes(needle) ||
        node.kind.toLowerCase().includes(needle) ||
        node.id.toLowerCase().includes(needle);
      return inLayer && matches;
    });
  }, [nodes, layer, query]);

  const layout = useMemo(
    () => layoutFlow(visible, topology?.edges ?? []),
    [visible, topology?.edges],
  );

  // Adjacency over the *whole* graph, so the inspector still tells the truth about a node's
  // dependencies while the canvas is filtered down to one layer.
  const adjacency = useMemo(() => {
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, key: string, value: string) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    for (const edge of topology?.edges ?? []) {
      if (edge.source === edge.target) continue;
      push(down, edge.source, edge.target);
      push(up, edge.target, edge.source);
    }
    return { up, down };
  }, [topology?.edges]);

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? visible[0] ?? nodes[0],
    [nodes, visible, selectedId],
  );

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const resolve = useCallback(
    (ids: string[] | undefined): TopologyNode[] =>
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

  // Picking from the list also moves the canvas — otherwise a selection off-screen looks like
  // nothing happened.
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
          The whole homelab, <em>as a flowchart.</em>
        </h1>
        <p className={s.lede}>
          Every box is a real workload read from the Kubernetes API, ranked by
          what it depends on: traffic enters at the top and falls through the
          gateway, the platform controllers, and the storage and data tiers into
          the applications they run. Select anything to inspect its live state,
          its metrics, and what sits on either side of it.
        </p>
      </header>

      <section className={s.workbench}>
        <div className={s.panel}>
          <Toolbar
            live={topology !== null}
            query={query}
            onQuery={setQuery}
            layer={layer}
            onLayer={setLayer}
            shown={visible.length}
            total={nodes.length}
          />

          {topology === null ? (
            <div className={s.loading}>
              <RefreshCw className={s.spin} size={22} />
              <span>{error ?? "Reading sanitized Kubernetes inventory…"}</span>
            </div>
          ) : layout.nodes.length === 0 ? (
            <div className={s.loading}>
              <span>Nothing matches that filter.</span>
            </div>
          ) : (
            <FlowChart
              layout={layout}
              selectedId={selected?.id ?? null}
              hoveredId={hoveredId}
              neighbours={neighbours}
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
          upstream={resolve(adjacency.up.get(selected?.id ?? ""))}
          downstream={resolve(adjacency.down.get(selected?.id ?? ""))}
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
