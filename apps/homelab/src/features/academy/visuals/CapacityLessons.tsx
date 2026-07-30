"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./visuals.module.css";

// Capacity and convergence.
//
// The three diagrams here answer three questions that get conflated constantly: how much demand is
// going unanswered, what the difference between an intention and a fact looks like, and how long a
// correct scale-out takes to become capacity.

// ── Offered against served ─────────────────────────────────────────────────

const BAR_VIEW_W = 640;
const BAR_VIEW_H = 190;

export function OfferedVsServed({
  animate,
  offered = 1600,
  served = 610,
}: {
  animate: boolean;
  offered?: number;
  served?: number;
}) {
  // Grown once on mount rather than looped: a bar chart that keeps re-animating is decoration, and
  // this one is being read rather than watched.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!animate) return;
    const id = window.setTimeout(() => setGrown(true), 60);
    return () => window.clearTimeout(id);
  }, [animate]);
  const visibleGrown = !animate || grown;

  const scale = (v: number) => (v / Math.max(offered, 1)) * 420;
  const shortfall = Math.max(0, offered - served);
  const sharePct = Math.round((served / Math.max(offered, 1)) * 100);

  return (
    <div className={styles.stage}>
      <svg
        viewBox={`0 0 ${BAR_VIEW_W} ${BAR_VIEW_H}`}
        role="img"
        aria-label={`${offered} requests a second offered, ${served} served — ${sharePct} percent, leaving ${shortfall} a second unanswered.`}
      >
        <text x={12} y={24} className={styles.labelStrong}>
          Demand against delivery
        </text>

        <text x={12} y={62} className={styles.label}>
          Offered
        </text>
        <rect
          x={92}
          y={48}
          width={420}
          height={20}
          rx={5}
          className={styles.barTrack}
        />
        <rect
          x={92}
          y={48}
          width={visibleGrown ? 420 : 0}
          height={20}
          rx={5}
          className={styles.barOffered}
          style={{ transition: animate ? "width 700ms ease-out" : undefined }}
        />
        <text x={526} y={63} className={styles.mono}>
          {offered}/s
        </text>

        <text x={12} y={106} className={styles.label}>
          Served
        </text>
        <rect
          x={92}
          y={92}
          width={420}
          height={20}
          rx={5}
          className={styles.barTrack}
        />
        <rect
          x={92}
          y={92}
          width={visibleGrown ? scale(served) : 0}
          height={20}
          rx={5}
          className={styles.barServed}
          style={{
            transition: animate ? "width 700ms ease-out 120ms" : undefined,
          }}
        />
        <rect
          x={92 + scale(served)}
          y={92}
          width={visibleGrown ? scale(shortfall) : 0}
          height={20}
          rx={5}
          className={styles.barShort}
          style={{
            transition: animate ? "width 700ms ease-out 120ms" : undefined,
          }}
        />
        <text x={526} y={107} className={styles.mono}>
          {served}/s
        </text>

        <line
          x1={92 + scale(served)}
          y1={84}
          x2={92 + scale(served)}
          y2={146}
          className={styles.axis}
        />
        <line x1={512} y1={84} x2={512} y2={146} className={styles.axis} />
        <text
          x={(92 + scale(served) + 512) / 2}
          y={140}
          textAnchor="middle"
          className={styles.monoBad}
        >
          {shortfall}/s never answered
        </text>

        <text x={12} y={172} className={styles.label}>
          Latency and error rate describe only the {sharePct}% that was served.
          The rest produced no sample at all.
        </text>
      </svg>
    </div>
  );
}

// ── Desired against observed ───────────────────────────────────────────────

const POD_W = 74;
const POD_H = 38;

/** The stages a pod passes through before it counts as capacity. */
const POD_STAGES = ["Scheduling", "Pulling", "Starting", "Ready"] as const;

export function DesiredVsObserved({ animate }: { animate: boolean }) {
  const desired = 4;
  // Cycles 1 → 4 ready so the gap between the two rows is something you watch close rather than
  // something you are told about. Settles full when animation is off.
  const [ready, setReady] = useState(desired);

  useEffect(() => {
    if (!animate) return;
    let n = 1;
    const reset = window.setTimeout(() => setReady(1), 0);
    const id = window.setInterval(() => {
      n = n >= desired ? 1 : n + 1;
      setReady(n);
    }, 1400);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(id);
    };
  }, [animate]);
  const visibleReady = animate ? ready : desired;

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 200"
        role="img"
        aria-label={`Checkout: ${desired} replicas desired, ${visibleReady} observed ready. The remainder are still scheduling or starting.`}
      >
        <text x={12} y={22} className={styles.labelStrong}>
          checkout · one tier, two numbers
        </text>

        <text x={12} y={62} className={styles.label}>
          Desired
        </text>
        <text x={12} y={78} className={styles.monoDim}>
          written instantly
        </text>
        {Array.from({ length: desired }, (_, i) => (
          <g key={`d${i}`}>
            <rect
              x={110 + i * (POD_W + 12)}
              y={44}
              width={POD_W}
              height={POD_H}
              rx={8}
              className={styles.podReady}
            />
            <text
              x={110 + i * (POD_W + 12) + 12}
              y={68}
              className={styles.podText}
            >
              pod {i + 1}
            </text>
          </g>
        ))}
        <text
          x={110 + desired * (POD_W + 12) + 8}
          y={68}
          className={styles.mono}
        >
          {desired}
        </text>

        <text x={12} y={132} className={styles.label}>
          Observed
        </text>
        <text x={12} y={148} className={styles.monoDim}>
          arrives in pieces
        </text>
        {Array.from({ length: desired }, (_, i) => {
          const isReady = i < visibleReady;
          return (
            <g key={`o${i}`}>
              <rect
                x={110 + i * (POD_W + 12)}
                y={114}
                width={POD_W}
                height={POD_H}
                rx={8}
                className={isReady ? styles.podReady : styles.podPending}
              />
              <text
                x={110 + i * (POD_W + 12) + 8}
                y={138}
                className={styles.podText}
              >
                {isReady
                  ? `pod ${i + 1}`
                  : POD_STAGES[Math.min(i - visibleReady, 2)]}
              </text>
            </g>
          );
        })}
        <text
          x={110 + desired * (POD_W + 12) + 8}
          y={138}
          className={styles.mono}
        >
          {visibleReady}
        </text>

        <text x={12} y={186} className={styles.label}>
          Capacity is the lower row. Until it catches up you have asked for room
          you do not have yet.
        </text>
      </svg>
    </div>
  );
}

// ── Replica convergence, driven by the learner ─────────────────────────────

/** Roughly how long one replica takes to go from requested to serving on this platform. */
const READY_DELAY_MS = 1500;

export function ReplicaConvergence({
  animate,
  value = 1,
}: {
  animate: boolean;
  value?: number;
}) {
  const desired = Math.max(1, Math.round(value));
  const [ready, setReady] = useState(desired);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];

    if (!animate) return;

    timers.current.push(window.setTimeout(() => setReady(1), 0));
    for (let n = 2; n <= desired; n += 1) {
      const step = n;
      timers.current.push(
        window.setTimeout(() => setReady(step), (step - 1) * READY_DELAY_MS),
      );
    }

    return () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, [desired, animate]);

  const visibleReady = animate ? ready : desired;
  const converged = visibleReady >= desired;
  // 120 requests a second per replica, which is the measured shape of this workload: six uncached
  // replicas serve about 720.
  const capacity = visibleReady * 120;

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 176"
        role="img"
        aria-label={`${desired} replicas desired, ${visibleReady} ready, ${capacity} requests a second of capacity.`}
      >
        <text x={12} y={22} className={styles.labelStrong}>
          {converged
            ? "Converged — desired and observed agree"
            : "Converging — capacity arrives one replica at a time"}
        </text>

        {Array.from({ length: 6 }, (_, i) => {
          const wanted = i < desired;
          const isReady = i < visibleReady;
          return (
            <g key={i}>
              <rect
                x={12 + i * 84}
                y={44}
                width={72}
                height={44}
                rx={9}
                className={
                  !wanted
                    ? styles.podGone
                    : isReady
                      ? styles.podReady
                      : styles.podPending
                }
              />
              <text x={22 + i * 84} y={70} className={styles.podText}>
                {!wanted ? "—" : isReady ? "ready" : "starting"}
              </text>
            </g>
          );
        })}

        <text x={12} y={122} className={styles.label}>
          Desired
        </text>
        <text x={78} y={122} className={styles.mono}>
          {desired}
        </text>
        <text x={140} y={122} className={styles.label}>
          Ready
        </text>
        <text
          x={196}
          y={122}
          className={converged ? styles.mono : styles.monoWarn}
        >
          {visibleReady}
        </text>
        <text x={258} y={122} className={styles.label}>
          Capacity
        </text>
        <text x={330} y={122} className={styles.mono}>
          ~{capacity}/s
        </text>

        <text x={12} y={158} className={styles.label}>
          {converged
            ? "Only now is the capacity you asked for actually serving traffic."
            : "The desired count changed the instant you moved the dial. The capacity has not arrived yet."}
        </text>
      </svg>
    </div>
  );
}
