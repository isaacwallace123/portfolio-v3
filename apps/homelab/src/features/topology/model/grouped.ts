import type { TopologyNode } from "@/shared/api/live-client";
import { LAYERS, layerLabel } from "./layers";

/**
 * Grouped map layout.
 *
 * Every component is drawn, inside a container for the layer it belongs to — the arrangement the v2
 * homelab used, and the reason it reads: a container is a background rather than an obstacle, so the
 * eye groups by enclosure instead of by tracing lines, and the members inside pack into a dense grid
 * rather than spreading across a rank.
 *
 * The previous attempt gave every component its own rank position and let a Sugiyama layout place
 * them. That is the right method for a pure flowchart and the wrong shape for this system: measured
 * on the live inventory it came out 2050px wide with 83% of the connector ink running sideways, and
 * dagre reproduced the same sprawl from the same graph. Enclosure does what coordinates could not.
 *
 * Connectors stay coarse by default — one per pair of layers — because eleven lines between six
 * containers is a diagram and thirty-eight between thirty-three boxes is a mess. The precise
 * component-level links are computed here too, and the view draws them for whatever is hovered.
 */

const MEMBER_W = 168;
const MEMBER_H = 52;
const MEMBER_GAP_X = 16;
const MEMBER_GAP_Y = 14;
/** Wider rows make a container squat and the whole map wide; three keeps it close to square. */
const MEMBERS_PER_ROW = 3;

const GROUP_PAD_X = 18;
const GROUP_PAD_Y = 16;
const GROUP_HEADER = 34;

/** Two containers abreast is the most that fits a panel without shrinking the labels away. */
const GROUPS_PER_ROW = 2;
const GROUP_GAP_X = 74;
const GROUP_GAP_Y = 64;
const PAD = 44;

export interface MemberBox {
  id: string;
  node: TopologyNode;
  groupId: string;
  layer: string;
  /** Absolute, so the renderer never has to compose transforms. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroupBox {
  id: string;
  layer: string;
  label: string;
  count: number;
  status: "healthy" | "degraded" | "unavailable";
  ready: number;
  desired: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  /** Layer of the source, so a connector is tinted by where it comes from. */
  layer: string;
  bidirectional?: boolean;
  weight?: number;
  points: { x: number; y: number }[];
}

export interface GroupedLayout {
  groups: GroupBox[];
  members: MemberBox[];
  /** Layer-to-layer connectors: what the map shows at rest. */
  groupEdges: MapEdge[];
  /** Component-to-component connectors, drawn for whatever is focused. */
  memberEdges: MapEdge[];
  width: number;
  height: number;
}

const groupIdOf = (layer: string) => `group:${layer}`;
const RANKED_STATUS = ["unavailable", "degraded", "healthy"] as const;

const EMPTY: GroupedLayout = {
  groups: [],
  members: [],
  groupEdges: [],
  memberEdges: [],
  width: 0,
  height: 0,
};

export function layoutGrouped(
  nodes: TopologyNode[],
  edges: { source: string; target: string; kind: string }[],
): GroupedLayout {
  if (nodes.length === 0) return EMPTY;

  const byLayer = new Map<string, TopologyNode[]>();
  for (const node of nodes) {
    const list = byLayer.get(node.layer);
    if (list) list.push(node);
    else byLayer.set(node.layer, [node]);
  }

  const present = LAYERS.map((l) => l.id).filter(
    (id) => (byLayer.get(id)?.length ?? 0) > 0,
  );

  // Container size follows its contents: a grid of members, plus a header and padding.
  const sized = present.map((layer) => {
    const members = byLayer.get(layer)!;
    const rows = Math.ceil(members.length / MEMBERS_PER_ROW);
    const perRow = Math.min(members.length, MEMBERS_PER_ROW);
    return {
      layer,
      members,
      rows,
      w: perRow * MEMBER_W + (perRow - 1) * MEMBER_GAP_X + GROUP_PAD_X * 2,
      h:
        GROUP_HEADER +
        GROUP_PAD_Y +
        rows * MEMBER_H +
        (rows - 1) * MEMBER_GAP_Y +
        GROUP_PAD_Y,
    };
  });

  const rank = rankLayers(present, nodes, edges);

  // Containers are placed by dependency rank, wrapped so no row runs wider than the panel. Reading
  // down is still reading the direction things flow; wrapping only stops a wide rank from forcing a
  // canvas that has to be shrunk to fit.
  const order = [...sized].sort(
    (a, b) =>
      (rank.get(a.layer) ?? 0) - (rank.get(b.layer) ?? 0) ||
      present.indexOf(a.layer) - present.indexOf(b.layer),
  );

  // Filled two abreast in rank order rather than one row per rank. Giving each rank its own row is
  // the stricter reading, and it produced a 1122×1396 column that fits a panel at 0.44 — the labels
  // lose more than the ordering gains. Reading is left to right then down, and dependency still
  // decides the sequence.
  const rows: (typeof sized)[] = [];
  for (let i = 0; i < order.length; i += GROUPS_PER_ROW) {
    rows.push(order.slice(i, i + GROUPS_PER_ROW));
  }

  const rowWidths = rows.map(
    (row) =>
      row.reduce((sum, g) => sum + g.w, 0) + (row.length - 1) * GROUP_GAP_X,
  );
  const widest = Math.max(...rowWidths);

  const groups: GroupBox[] = [];
  const members: MemberBox[] = [];
  let y = PAD;

  rows.forEach((row, rowIndex) => {
    // Centre each row against the widest one so the map reads as a column, not a ragged edge.
    let x = PAD + (widest - rowWidths[rowIndex]) / 2;
    const rowHeight = Math.max(...row.map((g) => g.h));

    for (const group of row) {
      const status =
        RANKED_STATUS.find((s) => group.members.some((m) => m.status === s)) ??
        "healthy";

      groups.push({
        id: groupIdOf(group.layer),
        layer: group.layer,
        label: layerLabel(group.layer),
        count: group.members.length,
        status,
        ready: group.members.reduce((sum, m) => sum + m.ready, 0),
        desired: group.members.reduce((sum, m) => sum + m.desired, 0),
        x,
        y,
        w: group.w,
        h: group.h,
      });

      group.members.forEach((node, i) => {
        const col = i % MEMBERS_PER_ROW;
        const row_ = Math.floor(i / MEMBERS_PER_ROW);
        // The last row of a container is centred, so a group of four does not leave a lone box
        // hanging off the left edge.
        const inRow = Math.min(
          MEMBERS_PER_ROW,
          group.members.length - row_ * MEMBERS_PER_ROW,
        );
        const rowW = inRow * MEMBER_W + (inRow - 1) * MEMBER_GAP_X;
        const startX = x + (group.w - rowW) / 2;

        members.push({
          id: node.id,
          node,
          groupId: groupIdOf(group.layer),
          layer: group.layer,
          x: startX + col * (MEMBER_W + MEMBER_GAP_X),
          y: y + GROUP_HEADER + GROUP_PAD_Y + row_ * (MEMBER_H + MEMBER_GAP_Y),
          w: MEMBER_W,
          h: MEMBER_H,
        });
      });

      x += group.w + GROUP_GAP_X;
    }

    y += rowHeight + GROUP_GAP_Y;
  });

  const boxOf = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();
  for (const g of groups) boxOf.set(g.id, g);
  for (const m of members) boxOf.set(m.id, m);

  const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));
  const groupFor = new Map(nodes.map((n) => [n.id, groupIdOf(n.layer)]));

  return {
    groups,
    members,
    groupEdges: route(aggregate(edges, groupFor, layerOf), boxOf),
    memberEdges: route(
      edges.map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        kind: e.kind,
        layer: layerOf.get(e.source) ?? "platform",
        weight: 1,
      })),
      boxOf,
    ),
    width: widest + PAD * 2,
    height: y - GROUP_GAP_Y + PAD,
  };
}

/** Ranks the layers against each other, so containers still read top to bottom by dependency. */
function rankLayers(
  present: string[],
  nodes: TopologyNode[],
  edges: { source: string; target: string }[],
): Map<string, number> {
  const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));
  const outgoing = new Map<string, Set<string>>(
    present.map((l) => [l, new Set<string>()]),
  );
  const indegree = new Map<string, number>(present.map((l) => [l, 0]));

  const seen = new Set<string>();
  for (const e of edges) {
    const from = layerOf.get(e.source);
    const to = layerOf.get(e.target);
    if (!from || !to || from === to) continue;
    const key = `${from} ${to}`;
    if (seen.has(key)) continue;
    // A pair that feeds both ways would be a cycle; the first direction seen wins the ordering.
    if (seen.has(`${to} ${from}`)) continue;
    seen.add(key);
    outgoing.get(from)!.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const rank = new Map(present.map((l) => [l, 0]));
  const queue = present.filter((l) => indegree.get(l) === 0);
  const pending = new Map(indegree);
  const visited: string[] = [];
  while (queue.length > 0) {
    const l = queue.shift()!;
    visited.push(l);
    for (const next of outgoing.get(l) ?? []) {
      const left = (pending.get(next) ?? 0) - 1;
      pending.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  for (const l of present) if (!visited.includes(l)) visited.push(l);
  for (const l of visited)
    for (const next of outgoing.get(l) ?? [])
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(l) ?? 0) + 1));

  return rank;
}

/** Rolls component links up to their containers, merging duplicates and two-way pairs. */
function aggregate(
  edges: { source: string; target: string; kind: string }[],
  groupFor: Map<string, string>,
  layerOf: Map<string, string>,
): Omit<MapEdge, "points">[] {
  const merged = new Map<string, Omit<MapEdge, "points">>();
  for (const e of edges) {
    const source = groupFor.get(e.source);
    const target = groupFor.get(e.target);
    if (!source || !target || source === target) continue;

    const back = merged.get(`${target} ${source}`);
    if (back) {
      back.bidirectional = true;
      back.weight = (back.weight ?? 1) + 1;
      continue;
    }
    const key = `${source} ${target}`;
    const existing = merged.get(key);
    if (existing) existing.weight = (existing.weight ?? 1) + 1;
    else
      merged.set(key, {
        id: key,
        source,
        target,
        kind: e.kind,
        layer: layerOf.get(e.source) ?? "platform",
        weight: 1,
      });
  }
  return [...merged.values()];
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Joins two boxes edge to edge on whichever sides face each other.
 *
 * Containers are backgrounds, so a connector may pass over one; what it must not do is start or end
 * underneath a box, which is what a centre-to-centre line does.
 */
function route(
  edges: Omit<MapEdge, "points">[],
  boxOf: Map<string, Box>,
): MapEdge[] {
  return edges.flatMap((edge) => {
    const a = boxOf.get(edge.source);
    const b = boxOf.get(edge.target);
    if (!a || !b) return [];
    const from = anchor(a, b);
    const to = anchor(b, a);
    return [{ ...edge, points: [from, to] }];
  });
}

/** The point on `box`'s border facing `toward`. */
function anchor(box: Box, toward: Box): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const tx = toward.x + toward.w / 2;
  const ty = toward.y + toward.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  // Leave through the side the other box actually lies on, so the stub never crosses its own box.
  if (Math.abs(dy) * box.w >= Math.abs(dx) * box.h) {
    return {
      x: cx + (dx / (Math.abs(dy) || 1)) * (box.h / 2),
      y: cy + Math.sign(dy) * (box.h / 2),
    };
  }
  return {
    x: cx + Math.sign(dx) * (box.w / 2),
    y: cy + (dy / (Math.abs(dx) || 1)) * (box.w / 2),
  };
}

/** A curve between two anchor points, bowed along the dominant axis. */
export function curvePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Bowing along whichever axis dominates keeps parallel connectors from collapsing onto each other.
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const bow = vertical ? Math.abs(dy) * 0.42 : Math.abs(dx) * 0.42;
  const c1 = vertical
    ? { x: a.x, y: a.y + Math.sign(dy) * bow }
    : { x: a.x + Math.sign(dx) * bow, y: a.y };
  const c2 = vertical
    ? { x: b.x, y: b.y - Math.sign(dy) * bow }
    : { x: b.x - Math.sign(dx) * bow, y: b.y };
  return `M ${r(a.x)} ${r(a.y)} C ${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(b.x)} ${r(b.y)}`;
}

const r = (n: number) => Math.round(n * 10) / 10;
