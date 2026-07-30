"use client";

import { Fragment } from "react";
import { useLoopedProgress } from "../model/motion";
import styles from "./visuals.module.css";

// The request path, and what happens to it as demand rises.
//
// Three lessons share this diagram because they are the same diagram: the path itself (segment 1),
// the queue forming at the constrained tier (segment 1's guided activity), and the front door being
// the constrained tier (segment 6). Splitting them into three components would have produced three
// slightly different drawings of one system, which is the thing a course must not do.
//
// The ceilings are the platform's measured ones. Six uncached checkout replicas serve about 720
// requests a second; a single Envoy replica starts queueing around 2000. Teaching with invented
// round numbers would make the lessons and the capstone disagree.

const GATEWAY_CEILING = 2000;
const CHECKOUT_CEILING = 720;
/** The gateway-flow lesson runs a deliberately large backend, so the front door is the only ceiling. */
const WIDE_BACKEND_CEILING = 2400;

interface Tier {
  id: string;
  name: string;
  role: string;
}

const TIERS: Tier[] = [
  { id: "k6", name: "Load generator", role: "demand" },
  { id: "envoy", name: "Envoy gateway", role: "admission" },
  { id: "checkout", name: "Checkout", role: "application" },
  { id: "redis", name: "Redis", role: "cache" },
  { id: "postgres", name: "Postgres", role: "data" },
];

const BOX_W = 148;
const BOX_H = 74;
const GAP = 40;
const LEFT = 12;
const TOP = 78;
const VIEW_W = LEFT * 2 + TIERS.length * BOX_W + (TIERS.length - 1) * GAP;
const VIEW_H = 214;

const boxX = (i: number) => LEFT + i * (BOX_W + GAP);

export interface RequestPathProps {
  animate: boolean;
  /** Offered requests a second. Undefined renders the healthy path with no dial attached. */
  value?: number;
  /** Segment 6 runs the same path with a backend that cannot be the constraint. */
  variant?: "path" | "queue" | "gateway";
}

/**
 * Resolve the illustration's arithmetic. Pulled out of the component because it is the part worth
 * being sure about: which tier is constrained, and how much traffic each tier actually sees.
 */
export function pathState(offered: number, backendCeiling: number) {
  const admitted = Math.min(offered, GATEWAY_CEILING);
  const served = Math.min(admitted, backendCeiling);
  const gatewayQueue = offered - admitted;
  const backendQueue = admitted - served;
  const constrained =
    gatewayQueue > 0 ? "envoy" : backendQueue > 0 ? "checkout" : null;
  return { admitted, served, gatewayQueue, backendQueue, constrained };
}

export function RequestPathLesson({
  animate,
  value,
  variant = "path",
}: RequestPathProps) {
  const offered = value ?? 400;
  const backendCeiling =
    variant === "gateway" ? WIDE_BACKEND_CEILING : CHECKOUT_CEILING;
  const { admitted, served, gatewayQueue, backendQueue, constrained } =
    pathState(offered, backendCeiling);

  const t = useLoopedProgress(2600, animate);

  // Tiers downstream of a constraint are starved rather than busy — that is the observation the
  // whole segment turns on, so it is drawn rather than described.
  const starvedFrom =
    constrained === "envoy" ? 2 : constrained === "checkout" ? 3 : null;

  const tone = (i: number): "hot" | "idle" | "live" => {
    if (TIERS[i].id === constrained) return "hot";
    if (starvedFrom !== null && i >= starvedFrom) return "idle";
    return "live";
  };

  const throughputAt = (i: number): number => {
    if (i === 0) return offered;
    if (i === 1) return admitted;
    return served;
  };

  // Packets in flight. Each segment of the path gets a number of dots proportional to what actually
  // flows through it, so a starved tier visibly has less arriving at it.
  const packetsFor = (i: number): number => {
    if (!animate) return 0;
    const flow = throughputAt(i + 1);
    const reference = Math.max(offered, 1);
    return Math.max(0, Math.round((flow / reference) * 4));
  };

  return (
    <div className={styles.stage}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={
          constrained === null
            ? `Request path: ${offered} requests a second offered and all of them served across five tiers.`
            : `Request path: ${offered} requests a second offered, ${served} served. The ${
                constrained === "envoy" ? "gateway" : "checkout"
              } tier is the constraint and the tiers behind it are underused.`
        }
      >
        {TIERS.slice(0, -1).map((tier, i) => {
          const x1 = boxX(i) + BOX_W;
          const x2 = boxX(i + 1);
          const y = TOP + BOX_H / 2;
          const starved = starvedFrom !== null && i + 1 >= starvedFrom;
          const cls = starved
            ? styles.linkStarved
            : animate
              ? styles.linkLive
              : styles.link;

          return (
            <Fragment key={tier.id}>
              <line x1={x1} y1={y} x2={x2} y2={y} className={cls} />
              <path
                d={`M ${x2 - 7} ${y - 4} L ${x2} ${y} L ${x2 - 7} ${y + 4}`}
                className={cls}
              />
              {Array.from({ length: packetsFor(i) }, (_, p) => {
                const phase = (t + p / Math.max(1, packetsFor(i))) % 1;
                return (
                  <circle
                    key={p}
                    cx={x1 + (x2 - x1) * phase}
                    cy={y}
                    r={3}
                    className={styles.packet}
                  />
                );
              })}
            </Fragment>
          );
        })}

        {TIERS.map((tier, i) => {
          const x = boxX(i);
          const state = tone(i);
          return (
            <g key={tier.id}>
              <rect
                x={x}
                y={TOP}
                width={BOX_W}
                height={BOX_H}
                rx={11}
                className={
                  state === "hot"
                    ? styles.tierBoxHot
                    : state === "idle"
                      ? styles.tierBoxIdle
                      : styles.tierBox
                }
              />
              <text x={x + 13} y={TOP + 21} className={styles.tierRole}>
                {tier.role}
              </text>
              <text x={x + 13} y={TOP + 40} className={styles.tierName}>
                {tier.name}
              </text>
              <text
                x={x + 13}
                y={TOP + 60}
                className={
                  state === "hot"
                    ? styles.tierValueHot
                    : state === "idle"
                      ? styles.tierValueIdle
                      : styles.tierValue
                }
              >
                {throughputAt(i)}/s
              </text>
            </g>
          );
        })}

        {/* The queue itself: requests waiting in front of whichever tier cannot admit them. */}
        {constrained !== null && (
          <QueueMarker
            x={boxX(constrained === "envoy" ? 1 : 2) - 18}
            depth={constrained === "envoy" ? gatewayQueue : backendQueue}
            animate={animate}
          />
        )}

        <text x={LEFT} y={26} className={styles.labelStrong}>
          {constrained === null
            ? "Keeping up — every tier sees the same rate"
            : constrained === "envoy"
              ? "Queue at the front door — the backend is starved, not busy"
              : "Queue at the application tier — the data tiers go quiet"}
        </text>
        <text x={LEFT} y={45} className={styles.label}>
          Offered {offered}/s · admitted {admitted}/s · served {served}/s
          {constrained !== null && ` · ${offered - served}/s waiting or shed`}
        </text>
      </svg>
    </div>
  );
}

/** Requests stacked in front of a tier. Drawn as discrete marks because a queue is a count of
 *  things that are waiting, not a shaded region. */
function QueueMarker({
  x,
  depth,
  animate,
}: {
  x: number;
  depth: number;
  animate: boolean;
}) {
  const marks = Math.min(6, Math.max(1, Math.round(depth / 260)));
  return (
    <g className={animate ? styles.pulse : undefined}>
      {Array.from({ length: marks }, (_, i) => (
        <circle
          key={i}
          cx={x - i * 9}
          cy={TOP + BOX_H / 2}
          r={3.2}
          className={styles.packetQueued}
        />
      ))}
      <text
        x={x - marks * 9 - 6}
        y={TOP + BOX_H / 2 + 22}
        textAnchor="end"
        className={styles.monoWarn}
      >
        {depth}/s waiting
      </text>
    </g>
  );
}
