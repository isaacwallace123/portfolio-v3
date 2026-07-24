"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  Cpu,
  GitPullRequest,
  Layers3,
  MemoryStick,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  fetchTopology,
  type HomelabTopology,
  type TopologyNode,
} from "@/shared/lib/liveClient";

const LAYERS = [
  ["all", "All Layers"],
  ["compute", "Compute"],
  ["network", "Network"],
  ["platform", "Platform"],
  ["data", "Data"],
  ["observe", "Observe"],
  ["apps", "Applications"],
] as const;

export default function TopologyGraph() {
  const [topology, setTopology] = useState<HomelabTopology | null>(null);
  const [selectedId, setSelectedId] = useState("homeops");
  const [activeLayerFilter, setActiveLayerFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodePositions, setNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await fetchTopology();
        if (active) {
          setTopology(next);
          setError(null);
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "Topology unavailable");
      }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const filteredNodes = useMemo(() => {
    if (!topology) return [];
    return topology.nodes.filter((node) => {
      const matchesLayer =
        activeLayerFilter === "all" || node.layer === activeLayerFilter;
      const matchesSearch =
        searchQuery === "" ||
        node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.kind.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesLayer && matchesSearch;
    });
  }, [topology, activeLayerFilter, searchQuery]);

  const selected = useMemo(
    () =>
      topology?.nodes.find((node) => node.id === selectedId) ??
      filteredNodes[0] ??
      topology?.nodes[0],
    [selectedId, topology, filteredNodes],
  );

  // Group nodes by layer for column-based flow rendering
  const nodesByLayer = useMemo(() => {
    if (!topology) return {};
    const layers = [
      "compute",
      "network",
      "platform",
      "data",
      "observe",
      "apps",
    ] as const;
    const grouped: Record<string, TopologyNode[]> = {};
    for (const l of layers) grouped[l] = [];
    for (const node of filteredNodes) {
      if (grouped[node.layer]) {
        grouped[node.layer].push(node);
      }
    }
    return grouped;
  }, [topology, filteredNodes]);

  // Recalculate element positions for SVG connection lines
  useEffect(() => {
    if (!topology || !containerRef.current) return;
    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const positions: Record<string, { x: number; y: number }> = {};

      const elements =
        containerRef.current.querySelectorAll<HTMLElement>("[data-node-id]");
      elements.forEach((el) => {
        const id = el.getAttribute("data-node-id");
        if (id) {
          const rect = el.getBoundingClientRect();
          positions[id] = {
            x: rect.left + rect.width / 2 - containerRect.left,
            y: rect.top + rect.height / 2 - containerRect.top,
          };
        }
      });
      setNodePositions(positions);
    }, 100);
    return () => clearTimeout(timer);
  }, [topology, filteredNodes, activeLayerFilter]);

  return (
    <main className="topology-page">
      <section className="topology-heading">
        <div>
          <p className="kicker">
            <Layers3 size={15} /> Sanitized live architecture
          </p>
          <h1>
            The whole homelab, <em>as a system.</em>
          </h1>
        </div>
        <p>
          Interactive 2D architecture flow. Inspect live GitOps deployments, K3s
          nodes, network routing, storage, and telemetry. Select any service to
          inspect its live state and metrics.
        </p>
      </section>

      <section className="topology-workbench">
        <div className="topology-canvas-panel" ref={containerRef}>
          <div className="topology-toolbar">
            <div className="toolbar-left">
              <span>
                <i className={topology ? "is-live" : ""} />
                {topology ? "LIVE INVENTORY" : "CONNECTING"}
              </span>
              <div className="search-box">
                <Search size={13} />
                <input
                  type="text"
                  placeholder="Filter nodes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="toolbar-right">
              <div className="layer-pills">
                {LAYERS.map(([id, label]) => (
                  <button
                    key={id}
                    className={activeLayerFilter === id ? "active" : ""}
                    onClick={() => setActiveLayerFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!topology ? (
            <div className="topology-loading">
              <RefreshCw className="spin" size={24} />
              <span>{error ?? "Reading sanitized Kubernetes inventory…"}</span>
            </div>
          ) : (
            <div className="topology-flow-grid">
              {/* SVG connection overlay */}
              <svg className="topology-svg-connections" aria-hidden="true">
                <defs>
                  <linearGradient
                    id="edgeGradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--mint)"
                      stopOpacity="0.6"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--acid)"
                      stopOpacity="0.6"
                    />
                  </linearGradient>
                </defs>
                {topology.edges.map((edge, idx) => {
                  const source = nodePositions[edge.source];
                  const target = nodePositions[edge.target];
                  if (!source || !target) return null;

                  const isHighlighted =
                    selectedId === edge.source || selectedId === edge.target;

                  // Smooth cubic bezier path
                  const dx = target.x - source.x;
                  const curve = Math.min(Math.abs(dx) * 0.5, 100);
                  const d = `M ${source.x} ${source.y} C ${source.x + curve} ${source.y}, ${target.x - curve} ${target.y}, ${target.x} ${target.y}`;

                  return (
                    <path
                      key={`${edge.source}-${edge.target}-${idx}`}
                      d={d}
                      fill="none"
                      stroke={
                        isHighlighted ? "var(--acid)" : "url(#edgeGradient)"
                      }
                      strokeWidth={isHighlighted ? 2.5 : 1.2}
                      strokeDasharray={
                        edge.kind === "hosts" ? "4,4" : undefined
                      }
                      opacity={isHighlighted ? 1 : 0.35}
                      className={isHighlighted ? "active-edge" : ""}
                    />
                  );
                })}
              </svg>

              {/* Layer Columns */}
              {(
                [
                  "compute",
                  "network",
                  "platform",
                  "data",
                  "observe",
                  "apps",
                ] as const
              ).map((layerId) => {
                const nodes = nodesByLayer[layerId] ?? [];
                if (
                  activeLayerFilter !== "all" &&
                  activeLayerFilter !== layerId
                )
                  return null;
                return (
                  <div
                    key={layerId}
                    className="layer-column"
                    data-layer-col={layerId}
                  >
                    <div className="layer-col-header">
                      <i className={`dot-${layerId}`} />
                      <span>{layerId.toUpperCase()}</span>
                      <small>({nodes.length})</small>
                    </div>
                    <div className="layer-col-nodes">
                      {nodes.map((node) => {
                        const isSelected = selectedId === node.id;
                        return (
                          <div
                            key={node.id}
                            data-node-id={node.id}
                            onClick={() => setSelectedId(node.id)}
                            className={`topology-node-card status-${node.status} ${isSelected ? "selected" : ""}`}
                          >
                            <div className="node-card-head">
                              <span
                                className={`status-indicator status-${node.status}`}
                              />
                              <span className="node-kind-badge">
                                {node.kind}
                              </span>
                            </div>
                            <h4 className="node-title">{node.label}</h4>
                            <div className="node-meta">
                              <span>
                                <Boxes size={12} /> {node.ready}/{node.desired}
                              </span>
                              <span>
                                <Cpu size={12} />{" "}
                                {node.cpuUtilizationPct !== null
                                  ? `${node.cpuUtilizationPct}%`
                                  : `${node.cpuMillicores}m`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="topology-legend">
            {LAYERS.filter(([id]) => id !== "all").map(([id, label]) => (
              <span key={id} data-layer={id}>
                <i /> {label}
              </span>
            ))}
          </div>
        </div>

        <aside className="topology-inspector">
          {selected ? (
            <>
              <div className="inspector-head">
                <span className={`node-status status-${selected.status}`}>
                  <i /> {selected.status}
                </span>
                <small>{selected.layer}</small>
                <h2>{selected.label}</h2>
                <p>{selected.kind}</p>
              </div>
              <p className="inspector-description">{selected.description}</p>
              <div className="inspector-metrics">
                <span>
                  <Boxes size={16} />
                  <small>Ready</small>
                  <b>
                    {selected.ready}/{selected.desired}
                  </b>
                </span>
                <span>
                  <Cpu size={16} />
                  <small>CPU</small>
                  <b>
                    {selected.cpuUtilizationPct !== null
                      ? `${selected.cpuUtilizationPct}%`
                      : `${selected.cpuMillicores}m`}
                  </b>
                </span>
                <span>
                  <MemoryStick size={16} />
                  <small>Memory</small>
                  <b>
                    {selected.memoryUtilizationPct !== null
                      ? `${selected.memoryUtilizationPct}%`
                      : `${selected.memoryMiB} MiB`}
                  </b>
                </span>
                <span>
                  <GitPullRequest size={16} />
                  <small>GitOps</small>
                  <b>{selected.gitOpsSync ?? "n/a"}</b>
                </span>
              </div>
              <div className="inspector-source">
                <Activity size={15} />
                <span>
                  <b>Last observed</b>
                  <small>
                    {new Date(selected.observedAt).toLocaleTimeString()}
                  </small>
                </span>
              </div>
            </>
          ) : null}
          <div className="inspector-list">
            <strong>COMPONENTS</strong>
            {topology?.nodes.map((node) => (
              <button
                key={node.id}
                onClick={() => setSelectedId(node.id)}
                className={node.id === selected?.id ? "selected" : ""}
              >
                <i className={`status-${node.status}`} />
                <span>
                  <b>{node.label}</b>
                  <small>{node.kind}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>
      {topology && (
        <p className="topology-source">
          {topology.source} Observed{" "}
          {new Date(topology.observedAt).toLocaleString()}.
        </p>
      )}
    </main>
  );
}
