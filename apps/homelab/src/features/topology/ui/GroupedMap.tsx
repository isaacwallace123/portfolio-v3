"use client";

import { createElement, memo, useEffect, useMemo, useRef } from "react";
import { Crosshair, Globe, Minus, Plus } from "lucide-react";
import { curvePath, type GroupedLayout, type MapEdge } from "../model/grouped";
import { layerIcon } from "../model/layers";
import { useViewport } from "../model/useViewport";
import { MemberNode } from "./MemberNode";
import s from "../topology.module.css";

interface Props {
  layout: GroupedLayout;
  selectedId: string | null;
  hoveredId: string | null;
  /** Ids one hop from the focus, over the component graph. */
  neighbours: Set<string>;
  /** Draw every component link at once instead of only the focused one's. */
  showAllLinks: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  focusRequest: { id: string; nonce: number } | null;
}

/**
 * The map: a container per layer, the components inside it, and connectors over the top.
 *
 * Containers are drawn first and never take pointer events, so they read as background — the eye
 * groups by enclosure rather than by following lines, which is the whole reason this arrangement
 * beats giving every component its own rank.
 *
 * At rest only the layer-to-layer connectors are drawn: eleven lines rather than thirty-eight.
 * Pointing at a component swaps them for that component's own links, which is the detail worth
 * having and the one thing a static drawing of this graph could never show clearly.
 */
function GroupedMapImpl({
  layout,
  selectedId,
  hoveredId,
  neighbours,
  showAllLinks,
  onSelect,
  onHover,
  focusRequest,
}: Props) {
  const {
    frameRef,
    viewport,
    panning,
    fit,
    centerOn,
    zoomIn,
    zoomOut,
    handlers,
  } = useViewport(layout.width, layout.height);

  const focusId = hoveredId ?? selectedId;
  const focusing = focusId !== null;

  const groupPaths = useMemo(
    () => layout.groupEdges.map((e) => ({ edge: e, d: curvePath(e.points) })),
    [layout.groupEdges],
  );
  const memberPaths = useMemo(
    () => layout.memberEdges.map((e) => ({ edge: e, d: curvePath(e.points) })),
    [layout.memberEdges],
  );

  // Which component links to draw: all of them on demand, otherwise only the focused component's.
  const activeLinks = useMemo(() => {
    if (showAllLinks) return memberPaths;
    if (!focusId) return [];
    return memberPaths.filter(
      ({ edge }) => edge.source === focusId || edge.target === focusId,
    );
  }, [memberPaths, showAllLinks, focusId]);

  // The coarse view steps aside as soon as there is something specific to show.
  const showGroupLinks = !showAllLinks && activeLinks.length === 0;

  const lastCentred = useRef(-1);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastCentred.current) return;
    lastCentred.current = focusRequest.nonce;
    const box =
      layout.members.find((m) => m.id === focusRequest.id) ??
      layout.servers.find((sv) => sv.id === focusRequest.id) ??
      layout.groups.find((g) => g.id === focusRequest.id);
    if (box) centerOn(box.x + box.w / 2, box.y + box.h / 2);
  }, [focusRequest, layout, centerOn]);

  return (
    <div className={s.canvas}>
      <div
        ref={frameRef}
        className={s.frame}
        data-panning={panning || undefined}
        {...handlers}
      >
        <svg
          className={s.svg}
          role="img"
          aria-label="Homelab components, grouped by layer, with the links between them"
        >
          <g
            transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
          >
            {/* Where traffic arrives. Context, so no status and no counts. */}
            {layout.entry && (
              <g
                className={s.entry}
                transform={`translate(${layout.entry.x} ${layout.entry.y})`}
              >
                <rect
                  className={s.entryBox}
                  width={layout.entry.w}
                  height={layout.entry.h}
                  rx={10}
                />
                <g
                  className={s.entryGlyph}
                  transform={`translate(16 ${layout.entry.h / 2 - 7})`}
                  aria-hidden="true"
                >
                  <Globe size={14} />
                </g>
                <text
                  className={s.entryLabel}
                  x={40}
                  y={layout.entry.h / 2 + 4}
                >
                  INTERNET
                </text>
              </g>
            )}

            {/* Containers: background only. */}
            <g className={s.groups}>
              {layout.groups.map((group) => (
                <g
                  key={group.id}
                  className={s.group}
                  data-layer={group.layer}
                  transform={`translate(${group.x} ${group.y})`}
                >
                  <rect
                    className={s.groupBox}
                    width={group.w}
                    height={group.h}
                    rx={16}
                  />
                  <g
                    className={s.groupGlyph}
                    transform="translate(17 11)"
                    aria-hidden="true"
                  >
                    {createElement(layerIcon(group.layer), { size: 12 })}
                  </g>
                  <text className={s.groupLabel} x={36} y={21}>
                    {group.label.toUpperCase()}
                  </text>
                  <text
                    className={s.groupMeta}
                    x={group.w - 14}
                    y={21}
                    textAnchor="end"
                  >
                    {group.count} · {group.ready}/{group.desired}
                  </text>
                  <circle
                    className={s.groupStatus}
                    data-status={group.status}
                    cx={group.w - 14 - measure(group)}
                    cy={17}
                    r={3.5}
                  />
                </g>
              ))}
            </g>

            {/* Layer-to-layer connectors, shown while nothing specific is focused. */}
            {showGroupLinks && (
              <g className={s.edges}>
                {groupPaths.map(({ edge, d }) => (
                  <Connector key={edge.id} edge={edge} d={d} coarse />
                ))}
              </g>
            )}

            {/* The machines everything else runs on, above the workloads rather than beside them. */}
            <g>
              {layout.servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  selected={selectedId === server.id}
                  related={server.id === focusId || neighbours.has(server.id)}
                  focusing={focusing && !showAllLinks}
                  onSelect={onSelect}
                  onHover={onHover}
                />
              ))}
            </g>

            <g>
              {layout.members.map((member) => (
                <MemberNode
                  key={member.id}
                  member={member}
                  selected={selectedId === member.id}
                  related={member.id === focusId || neighbours.has(member.id)}
                  focusing={focusing && !showAllLinks}
                  onSelect={onSelect}
                  onHover={onHover}
                />
              ))}
            </g>

            {/* Component links ride above the boxes so a highlighted path is never buried. */}
            <g className={s.edges}>
              {activeLinks.map(({ edge, d }) => (
                <Connector key={edge.id} edge={edge} d={d} />
              ))}
            </g>
          </g>
        </svg>
      </div>

      <div className={s.zoom}>
        <button type="button" onClick={zoomIn} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" onClick={zoomOut} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button type="button" onClick={fit} aria-label="Fit to view">
          <Crosshair size={14} />
        </button>
      </div>
      <p className={s.hint}>
        {showAllLinks
          ? "Drag to pan · scroll to zoom"
          : "Point at a component to trace it · drag to pan"}
      </p>
    </div>
  );
}

/** A machine. Bigger than a workload box, and showing what it is actually carrying. */
function ServerCard({
  server,
  selected,
  related,
  focusing,
  onSelect,
  onHover,
}: {
  server: GroupedLayout["servers"][number];
  selected: boolean;
  related: boolean;
  focusing: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { node, x, y, w, h } = server;
  return (
    <g
      data-flow-node={node.id}
      className={s.server}
      data-selected={selected || undefined}
      data-dim={focusing && !related ? "" : undefined}
      transform={`translate(${x} ${y})`}
      onClick={() => onSelect(node.id)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      tabIndex={0}
      role="button"
      aria-label={`${node.label} — ${node.kind}, ${node.status}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <rect className={s.serverBox} width={w} height={h} rx={11} />
      <circle
        className={s.serverStatus}
        data-status={node.status}
        cx={18}
        cy={22}
        r={4}
      />
      <text className={s.serverLabel} x={30} y={26}>
        {node.label}
      </text>
      <text className={s.serverMeta} x={16} y={46}>
        {node.kind}
      </text>
      <text className={s.serverLoad} x={16} y={62}>
        {node.cpuUtilizationPct !== null
          ? `CPU ${node.cpuUtilizationPct}%  ·  MEM ${node.memoryUtilizationPct ?? 0}%`
          : `${node.cpuMillicores}m  ·  ${node.memoryMiB} MiB`}
      </text>
      <title>{`${node.label} — ${node.kind}`}</title>
    </g>
  );
}

function Connector({
  edge,
  d,
  coarse,
}: {
  edge: MapEdge;
  d: string;
  coarse?: boolean;
}) {
  const end = edge.points[edge.points.length - 1];
  const start = edge.points[0];
  return (
    <g
      className={s.edge}
      data-layer={edge.layer}
      data-coarse={coarse || undefined}
      data-hosts={edge.kind === "hosts" || undefined}
    >
      <path className={s.edgeLine} d={d} />
      <circle className={s.edgeCap} cx={end.x} cy={end.y} r={coarse ? 4 : 3} />
      {edge.bidirectional && (
        <circle
          className={s.edgeCap}
          cx={start.x}
          cy={start.y}
          r={coarse ? 4 : 3}
        />
      )}
      <title>
        {`${edge.source} ${edge.bidirectional ? "↔" : "→"} ${edge.target}` +
          (edge.weight && edge.weight > 1
            ? ` — ${edge.weight} relationships`
            : ` (${edge.kind})`)}
      </title>
    </g>
  );
}

/** Rough width of the container's count text, so the status dot sits just left of it. */
const measure = (group: { count: number; ready: number; desired: number }) =>
  `${group.count} · ${group.ready}/${group.desired}`.length * 5.4 + 8;

export const GroupedMap = memo(GroupedMapImpl);
