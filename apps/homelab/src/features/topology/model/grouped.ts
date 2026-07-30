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

/** Servers are the machines everything else runs on, so they get a bigger card of their own. */
const SERVER_W = 202;
const SERVER_H = 74;
const SERVER_GAP = 18;
/** The "traffic arrives here" marker above the edge tier. */
const ENTRY_W = 138;
const ENTRY_H = 46;
/** Space between one tier of the chain and the next. */
const TIER_GAP = 46;

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

/** A physical machine: drawn above the workloads rather than beside them. */
export interface ServerBox {
  id: string;
  node: TopologyNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where traffic enters. Context rather than inventory, so it carries no status or counts. */
export interface EntryBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroupedLayout {
  entry: EntryBox | null;
  servers: ServerBox[];
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

export const ENTRY_ID = "__entry";

const EMPTY: GroupedLayout = {
  entry: null,
  servers: [],
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

  // The chain reads as a stack of tiers rather than a grid of equal peers, because the layers are
  // not peers: the machines carry the platform, the platform routes into the workloads. Compute sits
  // on top as bare server cards and the network edge directly beneath it, which is the shape the v2
  // homelab used and the reason its map was legible at a glance.
  const serverNodes = byLayer.get("compute") ?? [];
  const networkNodes = byLayer.get("network") ?? [];
  const gridLayers = LAYERS.map((l) => l.id).filter(
    (id) =>
      id !== "compute" &&
      id !== "network" &&
      (byLayer.get(id)?.length ?? 0) > 0,
  );

  const sizeOf = (layer: string, perRowCap: number) => {
    const members = byLayer.get(layer)!;
    const perRow = Math.min(members.length, perRowCap);
    const rows = Math.ceil(members.length / perRowCap);
    return {
      layer,
      members,
      perRow: perRowCap,
      w: perRow * MEMBER_W + (perRow - 1) * MEMBER_GAP_X + GROUP_PAD_X * 2,
      h:
        GROUP_HEADER +
        GROUP_PAD_Y +
        rows * MEMBER_H +
        (rows - 1) * MEMBER_GAP_Y +
        GROUP_PAD_Y,
    };
  };

  // The edge tier is one wide row: it is a path, not a pile, and wrapping it hides that.
  const networkSized =
    networkNodes.length > 0
      ? sizeOf("network", Math.min(networkNodes.length, 4))
      : null;
  const gridSized = gridLayers.map((l) => sizeOf(l, MEMBERS_PER_ROW));

  const gridRows: (typeof gridSized)[] = [];
  for (let i = 0; i < gridSized.length; i += GROUPS_PER_ROW)
    gridRows.push(gridSized.slice(i, i + GROUPS_PER_ROW));
  const gridRowWidths = gridRows.map(
    (row) => row.reduce((n, g) => n + g.w, 0) + (row.length - 1) * GROUP_GAP_X,
  );

  const serverRowW =
    serverNodes.length * SERVER_W + (serverNodes.length - 1) * SERVER_GAP;
  const contentW = Math.max(
    serverRowW,
    networkSized?.w ?? 0,
    ...gridRowWidths,
    ENTRY_W,
  );
  const centreX = PAD + contentW / 2;

  const groups: GroupBox[] = [];
  const members: MemberBox[] = [];
  const servers: ServerBox[] = [];
  let y = PAD;
  let entry: EntryBox | null = null;

  // Tier 0 — where traffic comes from.
  if (networkNodes.length > 0) {
    entry = { x: centreX - ENTRY_W / 2, y, w: ENTRY_W, h: ENTRY_H };
    y += ENTRY_H + TIER_GAP;
  }

  // Tier 1 — the machines.
  if (serverNodes.length > 0) {
    let sx = centreX - serverRowW / 2;
    for (const node of serverNodes) {
      servers.push({ id: node.id, node, x: sx, y, w: SERVER_W, h: SERVER_H });
      sx += SERVER_W + SERVER_GAP;
    }
    y += SERVER_H + TIER_GAP;
  }

  const placeGroup = (
    g: {
      layer: string;
      members: TopologyNode[];
      perRow: number;
      w: number;
      h: number;
    },
    x: number,
    top: number,
  ) => {
    const status =
      RANKED_STATUS.find((s) => g.members.some((m) => m.status === s)) ??
      "healthy";
    groups.push({
      id: groupIdOf(g.layer),
      layer: g.layer,
      label: layerLabel(g.layer),
      count: g.members.length,
      status,
      ready: g.members.reduce((n, m) => n + m.ready, 0),
      desired: g.members.reduce((n, m) => n + m.desired, 0),
      x,
      y: top,
      w: g.w,
      h: g.h,
    });
    g.members.forEach((node, i) => {
      const col = i % g.perRow;
      const row = Math.floor(i / g.perRow);
      // The last row is centred, so a trailing box never hangs off the left edge alone.
      const inRow = Math.min(g.perRow, g.members.length - row * g.perRow);
      const rowW = inRow * MEMBER_W + (inRow - 1) * MEMBER_GAP_X;
      members.push({
        id: node.id,
        node,
        groupId: groupIdOf(g.layer),
        layer: g.layer,
        x: x + (g.w - rowW) / 2 + col * (MEMBER_W + MEMBER_GAP_X),
        y: top + GROUP_HEADER + GROUP_PAD_Y + row * (MEMBER_H + MEMBER_GAP_Y),
        w: MEMBER_W,
        h: MEMBER_H,
      });
    });
  };

  // Tier 2 — the network edge, on its own row directly under the machines.
  if (networkSized) {
    placeGroup(networkSized, centreX - networkSized.w / 2, y);
    y += networkSized.h + TIER_GAP;
  }

  // Tier 3+ — everything the platform carries, two containers abreast.
  gridRows.forEach((row, i) => {
    let x = centreX - gridRowWidths[i] / 2;
    for (const g of row) {
      placeGroup(g, x, y);
      x += g.w + GROUP_GAP_X;
    }
    y += Math.max(...row.map((g) => g.h)) + GROUP_GAP_Y;
  });

  const boxOf = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();
  for (const g of groups) boxOf.set(g.id, g);
  for (const m of members) boxOf.set(m.id, m);
  for (const sv of servers) boxOf.set(sv.id, sv);
  if (entry) boxOf.set(ENTRY_ID, entry);

  const layerOf = new Map(nodes.map((n) => [n.id, n.layer]));
  const groupFor = new Map(
    nodes.map((n) => [n.id, n.layer === "compute" ? n.id : groupIdOf(n.layer)]),
  );

  // Traffic reaching the edge is real and worth drawing, but it is context rather than inventory, so
  // it hangs off the marker rather than off a component that claims to have been measured.
  const edgeTarget =
    networkNodes.find((n) => n.id === "cloudflare") ?? networkNodes[0];
  const entryEdges = edgeTarget
    ? [{ source: ENTRY_ID, target: edgeTarget.id, kind: "traffic" }]
    : [];

  const coarse = aggregate(edges, groupFor, layerOf);
  if (edgeTarget)
    coarse.push({
      id: `${ENTRY_ID} ${groupIdOf("network")}`,
      source: ENTRY_ID,
      target: groupIdOf("network"),
      kind: "traffic",
      layer: "network",
      weight: 1,
    });

  return {
    entry,
    servers,
    groups,
    members,
    groupEdges: route(coarse, boxOf),
    memberEdges: route(
      [...edges, ...entryEdges].map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        kind: e.kind,
        layer: layerOf.get(e.source) ?? "network",
        weight: 1,
      })),
      boxOf,
    ),
    width: contentW + PAD * 2,
    height: y - GROUP_GAP_Y + PAD,
  };
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
