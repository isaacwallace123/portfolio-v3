import type { TopologyNode } from "@/shared/api/live-client";

/**
 * Layered flowchart layout (the Sugiyama method), top to bottom.
 *
 * The previous layout put each *layer* in its own column and drew straight centre-to-centre lines
 * between them, which is why it read as a scribble: an edge from compute to platform crossed the
 * network column and went through whatever boxes were in the way. Position there carried no
 * meaning beyond "what kind of thing is this", which the colour already said.
 *
 * Here position means dependency. A node sits one rank below the deepest thing that feeds it, so
 * traffic and control flow downward and every arrow points the same way. The three phases are the
 * standard ones:
 *
 *   1. rank    — longest path from a source, so every edge spans at least one rank downward
 *   2. order   — median heuristic plus adjacent-swap passes, to cut edge crossings
 *   3. place   — pull each node toward its neighbours' average x, then enforce spacing
 *
 * The part that actually fixes the scribble is dummy nodes: an edge spanning more than one rank is
 * split into one virtual node per rank it crosses, and those take part in ordering and spacing like
 * any other node. Because a dummy reserves real space in the rank it passes through, a long edge
 * gets its own corridor instead of being drawn over whatever happens to be there.
 */

export const NODE_W = 196;
export const NODE_H = 58;
/** Horizontal breathing room between two boxes in the same rank. */
const H_GAP = 24;
/** Vertical distance between one rank's centre line and the next. */
const RANK_GAP = 124;
/** A dummy reserves a corridor rather than a box, so it only needs room for the line itself. */
const DUMMY_W = 10;
const PAD_X = 56;
const PAD_Y = 56;

export interface FlowNodeBox {
  id: string;
  node: TopologyNode;
  rank: number;
  /** Centre of the box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface FlowEdgeRoute {
  id: string;
  source: string;
  target: string;
  kind: string;
  /** Layer of the source node — edges are tinted by where they come from. */
  layer: string;
  /** Ordered points, source's bottom edge through any corridors to the target's top edge. */
  points: Point[];
}

export interface FlowLayout {
  nodes: FlowNodeBox[];
  edges: FlowEdgeRoute[];
  width: number;
  height: number;
  rankCount: number;
}

interface Item {
  id: string;
  rank: number;
  order: number;
  x: number;
  w: number;
  /** Item ids in the rank above / below that this one connects to. */
  up: string[];
  down: string[];
  nodeId?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

const EMPTY: FlowLayout = {
  nodes: [],
  edges: [],
  width: 0,
  height: 0,
  rankCount: 0,
};

export function layoutFlow(
  nodes: TopologyNode[],
  allEdges: GraphEdge[],
): FlowLayout {
  if (nodes.length === 0) return EMPTY;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Only edges whose endpoints both survived the current filter, and no self-loops: a self-loop has
  // no downward direction to contribute and would sit under its own box.
  const edges = allEdges.filter(
    (e) => e.source !== e.target && byId.has(e.source) && byId.has(e.target),
  );

  const rank = assignRanks(nodes, edges);
  balanceRanks(nodes, edges, rank);
  const { items, layers, chains } = buildLayers(nodes, edges, rank);

  orderLayers(layers, items);
  placeHorizontally(layers, items);

  return emit(byId, items, layers, chains);
}

/* ── 1. rank ──────────────────────────────────────────────────────────────── */

/**
 * Longest path from a source. Cycle-safe: anything still holding an in-edge after the topological
 * sweep is part of a cycle, and gets appended in a stable order rather than being dropped. The
 * inventory graph is acyclic today, but a layout that falls apart the moment someone adds a
 * feedback edge is a layout that will fall apart.
 */
function assignRanks(
  nodes: TopologyNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    outgoing.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const order: string[] = [];
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const pending = new Map(indegree);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id)!) {
      const left = (pending.get(next) ?? 0) - 1;
      pending.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  // Whatever is left is in a cycle; keep it in the layout at its declared position.
  for (const n of nodes) if (!order.includes(n.id)) order.push(n.id);

  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (const id of order)
    for (const next of outgoing.get(id) ?? [])
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));

  return rank;
}

/* ── 1b. width balancing ──────────────────────────────────────────────────── */

/**
 * Longest-path ranking is correct but lopsided: it pins every source to rank 0 and every fan-out to
 * one row, so this inventory came out 12 boxes wide and 6 deep — a 4:1 strip that has to be shrunk
 * to a third of its size before it fits, at which point no label is readable. Fitting a diagram you
 * then cannot read is not fitting it.
 *
 * So ranks are capped, and the overflow moves *down* into emptier ranks. A node may only move while
 * it stays above everything it feeds, which is what keeps every arrow pointing the same way — the
 * property the whole layout rests on. A node that feeds nothing can go as deep as it likes, and
 * those (the application row, the dashboards) are exactly the fan-outs that make a rank too wide.
 */
const MAX_RANK_WIDTH = 7;
/** How many ranks a node may sit below whatever feeds it before the move costs more than it saves. */
const MAX_DRIFT = 2;

function balanceRanks(
  nodes: TopologyNode[],
  edges: GraphEdge[],
  rank: Map<string, number>,
) {
  const successors = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const predecessors = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    successors.get(e.source)!.push(e.target);
    predecessors.get(e.target)!.push(e.source);
  }

  // How far down a node could move before it would sit level with something it feeds.
  const slack = (id: string) => {
    const next = successors.get(id) ?? [];
    if (next.length === 0) return Number.POSITIVE_INFINITY;
    const nearest = Math.min(...next.map((t) => rank.get(t) ?? 0));
    return nearest - 1 - (rank.get(id) ?? 0);
  };

  // Ranks below where the thing that feeds it sits. Balancing purely by available slack drags every
  // leaf to the bottom of the chart — a leaf feeds nothing, so nothing stops it — and Sealed
  // Secrets ends up level with the application API instead of beside the controller that reconciles
  // it. Keeping each node near its parent is what makes the drawing still describe the system.
  const drift = (id: string, at: number) => {
    const prev = predecessors.get(id) ?? [];
    if (prev.length === 0) return 0;
    return at - Math.max(...prev.map((p) => rank.get(p) ?? 0));
  };

  const width = () => {
    const counts = new Map<number, string[]>();
    for (const n of nodes) {
      const r = rank.get(n.id) ?? 0;
      counts.set(r, [...(counts.get(r) ?? []), n.id]);
    }
    return counts;
  };

  // Each pass moves at most one node per overfull rank, so the ranks below are re-measured before
  // the next decision — otherwise draining one rank simply overfills the next.
  for (let pass = 0; pass < nodes.length; pass++) {
    const counts = width();
    let moved = false;

    for (const [r, ids] of [...counts].sort((a, b) => a[0] - b[0])) {
      if (ids.length <= MAX_RANK_WIDTH) continue;
      // Of the nodes that can move at all, take the one that ends up closest to what feeds it, and
      // among equals the least connected — moving a hub stretches many edges, a leaf stretches one.
      // If every remaining candidate would drift too far, the rank stays wide: a rank one box over
      // budget is a smaller cost than a component drawn nowhere near the thing it belongs to.
      const candidate = ids
        .filter((id) => slack(id) > 0 && drift(id, r + 1) <= MAX_DRIFT)
        .sort(
          (a, b) =>
            drift(a, r + 1) - drift(b, r + 1) ||
            (successors.get(a)?.length ?? 0) - (successors.get(b)?.length ?? 0),
        )[0];
      if (candidate === undefined) continue;
      rank.set(candidate, r + 1);
      moved = true;
    }

    if (!moved) break;
  }
}

/* ── 2. layers and dummy corridors ────────────────────────────────────────── */

interface Chain {
  edge: GraphEdge;
  /** Item ids from source to target, including any dummies in between. */
  ids: string[];
}

function buildLayers(
  nodes: TopologyNode[],
  edges: GraphEdge[],
  rank: Map<string, number>,
) {
  const items = new Map<string, Item>();
  const rankCount = Math.max(0, ...nodes.map((n) => rank.get(n.id) ?? 0)) + 1;
  const layers: string[][] = Array.from({ length: rankCount }, () => []);

  const add = (item: Item) => {
    items.set(item.id, item);
    layers[item.rank].push(item.id);
    return item.id;
  };

  for (const n of nodes) {
    add({
      id: `n:${n.id}`,
      rank: rank.get(n.id) ?? 0,
      order: 0,
      x: 0,
      w: NODE_W,
      up: [],
      down: [],
      nodeId: n.id,
    });
  }

  const chains: Chain[] = [];
  edges.forEach((edge, index) => {
    const from = rank.get(edge.source)!;
    const to = rank.get(edge.target)!;
    const ids = [`n:${edge.source}`];

    // One corridor per rank the edge passes over, so it never crosses a rank it has no room in.
    for (let r = from + 1; r < to; r++) {
      ids.push(
        add({
          id: `d:${index}:${r}`,
          rank: r,
          order: 0,
          x: 0,
          w: DUMMY_W,
          up: [],
          down: [],
        }),
      );
    }
    ids.push(`n:${edge.target}`);

    for (let i = 0; i < ids.length - 1; i++) {
      items.get(ids[i])!.down.push(ids[i + 1]);
      items.get(ids[i + 1])!.up.push(ids[i]);
    }
    chains.push({ edge, ids });
  });

  for (const layer of layers)
    layer.forEach((id, i) => (items.get(id)!.order = i));

  return { items, layers, chains };
}

/* ── 3. ordering ──────────────────────────────────────────────────────────── */

/** Sweeps the median heuristic down and up, each pass followed by adjacent swaps that pay off. */
function orderLayers(layers: string[][], items: Map<string, Item>) {
  const positions = () => {
    for (const layer of layers)
      layer.forEach((id, i) => (items.get(id)!.order = i));
  };
  positions();

  let best = layers.map((l) => [...l]);
  let bestCrossings = countAll(layers, items);

  for (let pass = 0; pass < 8; pass++) {
    const downward = pass % 2 === 0;
    const range = downward
      ? [...layers.keys()].slice(1)
      : [...layers.keys()].slice(0, -1).reverse();

    for (const r of range) {
      const fixedSide = downward ? "up" : "down";
      const scored = layers[r].map((id) => ({
        id,
        median: medianOf(
          items
            .get(id)!
            [fixedSide as "up" | "down"].map(
              (other) => items.get(other)!.order,
            ),
        ),
        order: items.get(id)!.order,
      }));
      // A node with no neighbour on the fixed side has no opinion, so it holds its place.
      scored.sort((a, b) =>
        a.median < 0 || b.median < 0
          ? a.order - b.order
          : a.median - b.median || a.order - b.order,
      );
      layers[r] = scored.map((s) => s.id);
      positions();
    }

    transpose(layers, items);
    positions();

    const crossings = countAll(layers, items);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = layers.map((l) => [...l]);
    }
  }

  best.forEach((layer, r) => (layers[r] = layer));
  positions();
}

/** Median of a node's neighbour positions, biased toward the denser side when the count is even. */
function medianOf(indices: number[]): number {
  if (indices.length === 0) return -1;
  const sorted = [...indices].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  if (sorted.length === 2) return (sorted[0] + sorted[1]) / 2;
  const left = sorted[mid - 1] - sorted[0];
  const right = sorted[sorted.length - 1] - sorted[mid];
  return left + right === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : (sorted[mid - 1] * right + sorted[mid] * left) / (left + right);
}

/** Swaps neighbouring pairs while doing so removes crossings. Cheap, and it finishes the job the
 *  median heuristic leaves half-done. */
function transpose(layers: string[][], items: Map<string, Item>) {
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 6) {
    improved = false;
    for (let r = 0; r < layers.length; r++) {
      for (let i = 0; i < layers[r].length - 1; i++) {
        const before = localCrossings(layers, items, r);
        [layers[r][i], layers[r][i + 1]] = [layers[r][i + 1], layers[r][i]];
        layers[r].forEach((id, k) => (items.get(id)!.order = k));
        if (localCrossings(layers, items, r) < before) improved = true;
        else {
          [layers[r][i], layers[r][i + 1]] = [layers[r][i + 1], layers[r][i]];
          layers[r].forEach((id, k) => (items.get(id)!.order = k));
        }
      }
    }
  }
}

function localCrossings(
  layers: string[][],
  items: Map<string, Item>,
  r: number,
): number {
  let total = 0;
  if (r > 0) total += countBetween(layers[r - 1], items);
  if (r < layers.length - 1) total += countBetween(layers[r], items);
  return total;
}

function countAll(layers: string[][], items: Map<string, Item>): number {
  let total = 0;
  for (let r = 0; r < layers.length - 1; r++)
    total += countBetween(layers[r], items);
  return total;
}

/** Crossings between one rank and the one below it, counted pairwise — the graph is small enough
 *  that the obvious quadratic count is faster than the clever one. */
function countBetween(upper: string[], items: Map<string, Item>): number {
  const pairs: [number, number][] = [];
  upper.forEach((id, i) => {
    for (const down of items.get(id)!.down)
      pairs.push([i, items.get(down)!.order]);
  });
  let crossings = 0;
  for (let a = 0; a < pairs.length; a++)
    for (let b = a + 1; b < pairs.length; b++)
      if ((pairs[a][0] - pairs[b][0]) * (pairs[a][1] - pairs[b][1]) < 0)
        crossings++;
  return crossings;
}

/* ── 4. horizontal placement ──────────────────────────────────────────────── */

/** Pulls each item toward the average x of its neighbours, then pushes the rank back apart so
 *  nothing overlaps. Alternating the sweep direction keeps one end from dragging the whole layout. */
function placeHorizontally(layers: string[][], items: Map<string, Item>) {
  // Start packed left to right so every later pass has a feasible arrangement to relax from.
  for (const layer of layers) {
    let cursor = 0;
    for (const id of layer) {
      const item = items.get(id)!;
      item.x = cursor + item.w / 2;
      cursor += item.w + H_GAP;
    }
  }

  for (let pass = 0; pass < 6; pass++) {
    const downward = pass % 2 === 0;
    const order = downward ? [...layers.keys()] : [...layers.keys()].reverse();

    for (const r of order) {
      const layer = layers[r];
      const desired = layer.map((id) => {
        const item = items.get(id)!;
        const refs = downward ? item.up : item.down;
        if (refs.length === 0) return item.x;
        const sum = refs.reduce((acc, o) => acc + items.get(o)!.x, 0);
        return sum / refs.length;
      });

      // Left to right: never closer than half of each width plus the gap.
      for (let i = 0; i < layer.length; i++) {
        const item = items.get(layer[i])!;
        const floor =
          i === 0
            ? -Infinity
            : items.get(layer[i - 1])!.x +
              items.get(layer[i - 1])!.w / 2 +
              H_GAP +
              item.w / 2;
        item.x = Math.max(desired[i], floor);
      }
      // Right to left: pull back anything the first pass pushed further right than it wanted.
      for (let i = layer.length - 2; i >= 0; i--) {
        const item = items.get(layer[i])!;
        const next = items.get(layer[i + 1])!;
        const ceiling = next.x - next.w / 2 - H_GAP - item.w / 2;
        const floor =
          i === 0
            ? -Infinity
            : items.get(layer[i - 1])!.x +
              items.get(layer[i - 1])!.w / 2 +
              H_GAP +
              item.w / 2;
        item.x = Math.max(
          floor,
          Math.min(item.x, Math.max(desired[i], ceiling)),
        );
      }
    }
  }

  // Centre the narrower ranks under the widest one, so the chart reads as a shape rather than as
  // everything shoved against the left edge.
  const extent = (layer: string[]) => {
    const xs = layer.map((id) => items.get(id)!);
    return xs.length === 0
      ? { min: 0, max: 0 }
      : {
          min: Math.min(...xs.map((i) => i.x - i.w / 2)),
          max: Math.max(...xs.map((i) => i.x + i.w / 2)),
        };
  };
  const widest = layers.reduce((acc, layer) => {
    const { min, max } = extent(layer);
    return Math.max(acc, max - min);
  }, 0);
  for (const layer of layers) {
    const { min, max } = extent(layer);
    const shift = (widest - (max - min)) / 2 - min;
    for (const id of layer) items.get(id)!.x += shift;
  }
}

/* ── 5. emit ──────────────────────────────────────────────────────────────── */

function emit(
  byId: Map<string, TopologyNode>,
  items: Map<string, Item>,
  layers: string[][],
  chains: Chain[],
): FlowLayout {
  const minX = Math.min(
    ...[...items.values()].map((item) => item.x - item.w / 2),
  );
  const shift = PAD_X - minX;
  const rankY = (rank: number) => PAD_Y + NODE_H / 2 + rank * RANK_GAP;

  const at = (id: string): Point => {
    const item = items.get(id)!;
    return { x: item.x + shift, y: rankY(item.rank) };
  };

  const boxes: FlowNodeBox[] = [];
  for (const item of items.values()) {
    if (!item.nodeId) continue;
    const node = byId.get(item.nodeId);
    if (!node) continue;
    const { x, y } = at(item.id);
    boxes.push({
      id: node.id,
      node,
      rank: item.rank,
      x,
      y,
      w: NODE_W,
      h: NODE_H,
    });
  }

  // Waypoints first — box edge, corridors, box edge — then the sideways steps between them.
  const waypoints = chains.map(({ edge, ids }) => {
    const points = ids.map(at);
    // Leave from the source's bottom edge and arrive at the target's top edge, so the arrowhead
    // lands on the border instead of under the box.
    points[0] = { x: points[0].x, y: points[0].y + NODE_H / 2 };
    points[points.length - 1] = {
      x: points[points.length - 1].x,
      y: points[points.length - 1].y - NODE_H / 2,
    };
    return { edge, points };
  });

  const routes: FlowEdgeRoute[] = assignLanes(waypoints).map(
    ({ edge, points }) => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      layer: byId.get(edge.source)?.layer ?? "platform",
      points,
    }),
  );

  const width = Math.max(...boxes.map((b) => b.x + b.w / 2), PAD_X) + PAD_X;
  const height = rankY(layers.length - 1) + NODE_H / 2 + PAD_Y;
  return {
    nodes: boxes,
    edges: routes,
    width,
    height,
    rankCount: layers.length,
  };
}

/* ── channel lanes ────────────────────────────────────────────────────────── */

/** Vertical distance between two horizontal runs sharing the same gap between ranks. */
const LANE_GAP = 9;

/**
 * Turns waypoints into a full right-angle polyline, giving each sideways step its own lane.
 *
 * Every edge that steps across between the same two ranks would otherwise do it at exactly the same
 * y — the midpoint — so eight connectors merge into one long horizontal smear and it stops being
 * possible to tell which line goes where. Lanes are assigned the way a scheduler assigns rooms:
 * runs are sorted by where they start, and each takes the lowest lane whose existing runs it does
 * not overlap. Runs that never touch share a lane, so in practice this costs two or three of them
 * rather than one per edge.
 */
function assignLanes<T extends { points: Point[] }>(routes: T[]): T[] {
  interface Run {
    route: number;
    /** Index of the waypoint pair this run sits between. */
    hop: number;
    midY: number;
    from: number;
    to: number;
  }

  const runs: Run[] = [];
  routes.forEach((route, i) => {
    for (let h = 1; h < route.points.length; h++) {
      const a = route.points[h - 1];
      const b = route.points[h];
      if (Math.abs(a.x - b.x) < 0.5) continue;
      runs.push({
        route: i,
        hop: h,
        midY: (a.y + b.y) / 2,
        from: Math.min(a.x, b.x),
        to: Math.max(a.x, b.x),
      });
    }
  });

  // Lane assignment is per channel: two runs only compete if they share a gap between ranks.
  const byChannel = new Map<number, Run[]>();
  for (const run of runs) {
    const key = Math.round(run.midY);
    byChannel.set(key, [...(byChannel.get(key) ?? []), run]);
  }

  const lane = new Map<string, number>();
  for (const group of byChannel.values()) {
    const taken: { from: number; to: number }[][] = [];
    for (const run of [...group].sort((a, b) => a.from - b.from)) {
      let slot = taken.findIndex(
        (occupants) =>
          !occupants.some((o) => run.from < o.to && run.to > o.from),
      );
      if (slot === -1) slot = taken.push([]) - 1;
      taken[slot].push({ from: run.from, to: run.to });
      lane.set(`${run.route}:${run.hop}`, slot);
    }
    // Centre the lanes in the channel so the bundle sits between the ranks rather than against one.
    const count = taken.length;
    for (const run of group) {
      const key = `${run.route}:${run.hop}`;
      lane.set(key, (lane.get(key) ?? 0) - (count - 1) / 2);
    }
  }

  // A lane may never stray so far that it touches the boxes above or below it.
  const limit = (RANK_GAP - NODE_H) / 2 - 6;

  return routes.map((route, i) => {
    const points: Point[] = [route.points[0]];
    for (let h = 1; h < route.points.length; h++) {
      const a = route.points[h - 1];
      const b = route.points[h];
      if (Math.abs(a.x - b.x) < 0.5) {
        points.push(b);
        continue;
      }
      const offset = (lane.get(`${i}:${h}`) ?? 0) * LANE_GAP;
      const channel =
        (a.y + b.y) / 2 + Math.max(-limit, Math.min(limit, offset));
      points.push({ x: a.x, y: channel }, { x: b.x, y: channel }, b);
    }
    return { ...route, points };
  });
}

/* ── connector geometry ───────────────────────────────────────────────────── */

/**
 * Draws an already-orthogonal polyline with rounded corners — the right-angle path a flowchart is
 * read in, rather than a diagonal that only its two endpoints explain.
 *
 * The corner radius shrinks to fit whichever of the two segments is shorter, so a short jog stays a
 * clean corner instead of collapsing into a curve that overshoots the line it belongs to.
 */
export function orthogonalPath(points: Point[], radius = 11): string {
  if (points.length === 0) return "";
  if (points.length === 1)
    return `M ${round(points[0].x)} ${round(points[0].y)}`;

  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];

    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);

    if (r < 0.5) {
      d += ` L ${round(corner.x)} ${round(corner.y)}`;
      continue;
    }

    const entry = along(corner, prev, r);
    const exit = along(corner, next, r);
    d +=
      ` L ${round(entry.x)} ${round(entry.y)}` +
      ` Q ${round(corner.x)} ${round(corner.y)} ${round(exit.x)} ${round(exit.y)}`;
  }

  const end = points[points.length - 1];
  return `${d} L ${round(end.x)} ${round(end.y)}`;
}

/** The point `distance` away from `from`, heading toward `toward`. */
function along(from: Point, toward: Point, distance: number): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: from.x + (dx / len) * distance,
    y: from.y + (dy / len) * distance,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
