"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/* ── layer colours ────────────────────────────────────────────────────────── */
const LAYER_COLORS: Record<string, string> = {
  compute: "#72a8ff",
  network: "#4de9dd",
  platform: "var(--mint)",
  data: "#d28cff",
  observe: "#ffc857",
  apps: "var(--acid)",
};

const LAYERS = [
  ["all", "All Layers"],
  ["compute", "Compute"],
  ["network", "Network"],
  ["platform", "Platform"],
  ["data", "Data"],
  ["observe", "Observe"],
  ["apps", "Applications"],
] as const;

/* ── layout engine ────────────────────────────────────────────────────────── */
// Positions nodes in layer columns, top-down, auto-spaced.

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: TopologyNode;
}

const NODE_W = 200;
const NODE_H = 56;
const COL_GAP = 60;
const ROW_GAP = 22;
const PAD_X = 60;
const PAD_Y = 80;

const LAYER_ORDER = [
  "compute",
  "network",
  "platform",
  "data",
  "observe",
  "apps",
] as const;

function layoutNodes(
  nodes: TopologyNode[],
  activeLayerFilter: string,
): { positioned: LayoutNode[]; width: number; height: number } {
  const grouped: Record<string, TopologyNode[]> = {};
  for (const l of LAYER_ORDER) grouped[l] = [];
  for (const node of nodes) {
    if (grouped[node.layer]) grouped[node.layer].push(node);
  }

  const visibleLayers =
    activeLayerFilter === "all"
      ? LAYER_ORDER.filter((l) => grouped[l].length > 0)
      : LAYER_ORDER.filter(
          (l) => l === activeLayerFilter && grouped[l].length > 0,
        );

  const positioned: LayoutNode[] = [];
  let maxH = 0;

  visibleLayers.forEach((layerId, colIdx) => {
    const colNodes = grouped[layerId];
    const cx = PAD_X + colIdx * (NODE_W + COL_GAP) + NODE_W / 2;

    colNodes.forEach((node, rowIdx) => {
      const cy = PAD_Y + rowIdx * (NODE_H + ROW_GAP) + NODE_H / 2;
      positioned.push({
        id: node.id,
        x: cx,
        y: cy,
        w: NODE_W,
        h: NODE_H,
        node,
      });
      maxH = Math.max(maxH, cy + NODE_H / 2);
    });
  });

  const totalW =
    PAD_X * 2 +
    visibleLayers.length * NODE_W +
    (visibleLayers.length - 1) * COL_GAP;
  const totalH = maxH + PAD_Y;
  return {
    positioned,
    width: Math.max(totalW, 600),
    height: Math.max(totalH, 400),
  };
}

/* ── component ────────────────────────────────────────────────────────────── */

export default function TopologyGraph() {
  const [topology, setTopology] = useState<HomelabTopology | null>(null);
  const [selectedId, setSelectedId] = useState("homeops");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeLayerFilter, setActiveLayerFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [animate, setAnimate] = useState(false);

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

  // Start animation when visible
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setAnimate(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [topology]);

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

  const {
    positioned,
    width: svgW,
    height: svgH,
  } = useMemo(
    () => layoutNodes(filteredNodes, activeLayerFilter),
    [filteredNodes, activeLayerFilter],
  );

  const posMap = useMemo(() => {
    const m: Record<string, LayoutNode> = {};
    for (const p of positioned) m[p.id] = p;
    return m;
  }, [positioned]);

  // Filter edges to visible nodes
  const visibleEdges = useMemo(() => {
    if (!topology) return [];
    return topology.edges.filter((e) => posMap[e.source] && posMap[e.target]);
  }, [topology, posMap]);

  const isHighlighted = useCallback(
    (nodeId: string) => {
      const focusId = hoveredId ?? selectedId;
      if (nodeId === focusId) return true;
      if (!topology) return false;
      return topology.edges.some(
        (e) =>
          (e.source === focusId && e.target === nodeId) ||
          (e.target === focusId && e.source === nodeId),
      );
    },
    [hoveredId, selectedId, topology],
  );

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
          Interactive architecture flowchart. Inspect live GitOps deployments,
          K3s nodes, network routing, storage, and telemetry. Select any service
          to inspect its live state and metrics.
        </p>
      </section>

      <section className="topology-workbench">
        <div className="topology-canvas-panel">
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
            <div className="topo-svg-wrap">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="topo-flowchart-svg"
                role="img"
                aria-label="Homelab infrastructure topology flowchart"
              >
                {/* ── Wires ────────────────────────────────── */}
                {visibleEdges.map((edge, idx) => {
                  const s = posMap[edge.source];
                  const t = posMap[edge.target];
                  if (!s || !t) return null;

                  const focusId = hoveredId ?? selectedId;
                  const lit =
                    focusId === edge.source || focusId === edge.target;

                  // Straight line from node edge
                  const sx = s.x;
                  const sy = s.y + (s.y < t.y ? s.h / 2 : -s.h / 2);
                  const tx = t.x;
                  const ty = t.y + (t.y < s.y ? t.h / 2 : -t.h / 2);

                  const wirePath = `M ${sx} ${sy} L ${tx} ${ty}`;

                  const sColor = LAYER_COLORS[s.node.layer] ?? "var(--line-2)";

                  return (
                    <g key={`e-${edge.source}-${edge.target}-${idx}`}>
                      <path
                        d={wirePath}
                        fill="none"
                        stroke={lit ? sColor : "var(--line-2)"}
                        strokeWidth={lit ? 2 : 1.2}
                        strokeDasharray={
                          edge.kind === "hosts" ? "6,4" : undefined
                        }
                        style={{
                          transition:
                            "stroke var(--dur-base) ease, stroke-width var(--dur-base) ease",
                        }}
                        opacity={lit ? 1 : 0.5}
                      />
                      {/* animated packet dot */}
                      {animate && (
                        <circle r="3" fill={sColor} opacity={lit ? 1 : 0.5}>
                          <animateMotion
                            dur={`${2.4 + (idx % 5) * 0.3}s`}
                            repeatCount="indefinite"
                            path={wirePath}
                            calcMode="linear"
                            keyPoints="0;1;0"
                            keyTimes="0;0.5;1"
                          />
                        </circle>
                      )}
                    </g>
                  );
                })}

                {/* ── Nodes ────────────────────────────────── */}
                {positioned.map((ln) => {
                  const lit = isHighlighted(ln.id);
                  const isSel = selectedId === ln.id;
                  const color = LAYER_COLORS[ln.node.layer] ?? "var(--mint)";

                  return (
                    <g
                      key={ln.id}
                      className="topo-node-g"
                      onMouseEnter={() => setHoveredId(ln.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => setSelectedId(ln.id)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* node rect */}
                      <rect
                        x={ln.x - ln.w / 2}
                        y={ln.y - ln.h / 2}
                        width={ln.w}
                        height={ln.h}
                        rx={12}
                        fill="var(--topo-card, rgba(12,30,24,0.92))"
                        stroke={isSel ? color : lit ? color : "var(--line-2)"}
                        strokeWidth={isSel ? 2 : lit ? 1.8 : 1.2}
                        style={{
                          transition:
                            "stroke var(--dur-base) ease, filter var(--dur-base) ease",
                          filter: lit
                            ? `drop-shadow(0 6px 18px color-mix(in srgb, ${color} 30%, transparent))`
                            : "none",
                        }}
                      />
                      {/* status dot */}
                      <circle
                        cx={ln.x - ln.w / 2 + 18}
                        cy={ln.y - 6}
                        r={4}
                        fill={
                          ln.node.status === "healthy"
                            ? color
                            : ln.node.status === "degraded"
                              ? "var(--amber)"
                              : "var(--red)"
                        }
                      />
                      {/* label */}
                      <text
                        x={ln.x - ln.w / 2 + 30}
                        y={ln.y - 2}
                        fill="var(--ink)"
                        style={{
                          font: "700 12px ui-monospace, monospace",
                        }}
                      >
                        {ln.node.label}
                      </text>
                      {/* subtitle */}
                      <text
                        x={ln.x - ln.w / 2 + 30}
                        y={ln.y + 16}
                        fill="var(--ink-dim)"
                        style={{
                          font: "600 9px ui-monospace, monospace",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {ln.node.kind} · {ln.node.ready}/{ln.node.desired}
                      </text>
                    </g>
                  );
                })}
              </svg>
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
