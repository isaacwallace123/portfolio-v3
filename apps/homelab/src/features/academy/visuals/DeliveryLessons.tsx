"use client";

import { useEffect, useState } from "react";
import { useLoopedProgress } from "../model/motion";
import styles from "./visuals.module.css";

// Releases, data, scheduling and verification.
//
// Each of these draws the one thing its segment keeps insisting on: that two builds share an
// endpoint, that a cache decides what a request could possibly have observed, that a drain is a
// replacement rather than a move, and that an objective is a set of conditions holding over time.

// ── Stable and candidate tracks ────────────────────────────────────────────

export function ReleaseTracks({ animate }: { animate: boolean }) {
  const t = useLoopedProgress(3200, animate);
  const stable = 4;
  const candidate = 2;

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 200"
        role="img"
        aria-label="One endpoint served by four stable replicas and two candidate replicas. Failures cluster on the candidate build."
      >
        <text x={12} y={22} className={styles.labelStrong}>
          checkout · one endpoint, two builds
        </text>

        <rect
          x={12}
          y={78}
          width={104}
          height={44}
          rx={9}
          className={styles.tierBox}
        />
        <text x={26} y={97} className={styles.tierRole}>
          admission
        </text>
        <text x={26} y={113} className={styles.tierName}>
          Envoy
        </text>

        {/* Traffic fans out to every ready pod regardless of which build it runs. That is the whole
            mechanism — there is no separate split dial. */}
        {[0, 1].map((track) => {
          const y = track === 0 ? 62 : 140;
          return (
            <path
              key={track}
              d={`M 116 100 C 160 100, 170 ${y}, 214 ${y}`}
              className={animate ? styles.linkLive : styles.link}
            />
          );
        })}

        <text x={214} y={44} className={styles.label}>
          stable · {stable} replicas · 67% of traffic
        </text>
        {Array.from({ length: stable }, (_, i) => (
          <rect
            key={`s${i}`}
            x={214 + i * 62}
            y={52}
            width={54}
            height={30}
            rx={7}
            className={styles.podReady}
          />
        ))}

        <text x={214} y={130} className={styles.label}>
          candidate · {candidate} replicas · 33% of traffic
        </text>
        {Array.from({ length: candidate }, (_, i) => (
          <rect
            key={`c${i}`}
            x={214 + i * 62}
            y={138}
            width={54}
            height={30}
            rx={7}
            className={styles.podFailing}
          />
        ))}

        {animate &&
          [0, 1, 2].map((i) => {
            const phase = (t + i / 3) % 1;
            const onCandidate = i === 2;
            const y = onCandidate ? 153 : 67;
            return (
              <circle
                key={i}
                cx={116 + (214 - 116) * phase}
                cy={100 + (y - 100) * phase}
                r={3}
                className={onCandidate ? styles.packetDropped : styles.packet}
              />
            );
          })}

        <text x={12} y={188} className={styles.label}>
          A request&apos;s trace carries the build that answered it. Exposure is
          replica share — there is no separate percentage to set.
        </text>
      </svg>
    </div>
  );
}

// ── Cache hit and miss ─────────────────────────────────────────────────────

export function CacheFlow({ animate }: { animate: boolean }) {
  const t = useLoopedProgress(3000, animate);

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 200"
        role="img"
        aria-label="Requests from checkout are answered by Redis on a hit and reach Postgres on a miss. Only the miss path observes the state of the data."
      >
        <text x={12} y={22} className={styles.labelStrong}>
          What a request could possibly have observed
        </text>

        <rect
          x={12}
          y={78}
          width={116}
          height={46}
          rx={9}
          className={styles.tierBox}
        />
        <text x={26} y={97} className={styles.tierRole}>
          application
        </text>
        <text x={26} y={114} className={styles.tierName}>
          Checkout
        </text>

        <path
          d="M 128 88 C 190 88, 200 60, 262 60"
          className={animate ? styles.linkLive : styles.link}
        />
        <path
          d="M 128 114 C 190 114, 200 152, 262 152"
          className={styles.link}
        />

        <rect
          x={262}
          y={38}
          width={124}
          height={44}
          rx={9}
          className={styles.tierBox}
        />
        <text x={276} y={56} className={styles.tierRole}>
          cache hit
        </text>
        <text x={276} y={72} className={styles.tierName}>
          Redis
        </text>

        <rect
          x={262}
          y={130}
          width={124}
          height={44}
          rx={9}
          className={styles.tierBoxHot}
        />
        <text x={276} y={148} className={styles.tierRole}>
          cache miss
        </text>
        <text x={276} y={164} className={styles.tierName}>
          Postgres
        </text>

        <text x={402} y={58} className={styles.mono}>
          ~70% of reads
        </text>
        <text x={402} y={76} className={styles.monoDim}>
          never sees the data tier
        </text>
        <text x={402} y={150} className={styles.monoBad}>
          ~30% of reads
        </text>
        <text x={402} y={168} className={styles.monoDim}>
          the only path that can notice
        </text>

        {animate &&
          [0, 1, 2, 3].map((i) => {
            const phase = (t + i / 4) % 1;
            const hit = i < 3;
            const y0 = hit ? 88 : 114;
            const y1 = hit ? 60 : 152;
            return (
              <circle
                key={i}
                cx={128 + (262 - 128) * phase}
                cy={y0 + (y1 - y0) * phase}
                r={3}
                className={hit ? styles.packet : styles.packetQueued}
              />
            );
          })}
      </svg>
    </div>
  );
}

// ── Drain and migration ────────────────────────────────────────────────────

/** Where each pod is, once the drain has started. */
type PodPlace = "apps" | "moving" | "infra";

export function DrainMigration({
  animate,
  value = 1,
}: {
  animate: boolean;
  value?: number;
}) {
  const replicas = Math.max(1, Math.min(4, Math.round(value)));
  // 0 = before the drain, 1 = mid-replacement, 2 = settled. Cycled so the availability window is
  // something you watch happen; frozen mid-replacement when animation is off, because that is the
  // frame the lesson is about.
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (!animate) return;
    const reset = window.setTimeout(() => setStep(0), 0);
    const id = window.setInterval(() => setStep((s) => (s + 1) % 3), 1800);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(id);
    };
  }, [animate, replicas]);
  const visibleStep = animate ? step : 1;

  const place = (i: number): PodPlace => {
    if (visibleStep === 0) return "apps";
    if (visibleStep === 2) return "infra";
    // Mid-replacement: the first pod is being replaced and the rest are still serving.
    return i === 0 ? "moving" : "apps";
  };

  const serving = Array.from({ length: replicas }, (_, i) => place(i)).filter(
    (p) => p !== "moving",
  ).length;
  const outage = serving === 0;

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 212"
        role="img"
        aria-label={`Draining with ${replicas} replicas: ${serving} still serving during the replacement window.`}
      >
        <text x={12} y={22} className={styles.labelStrong}>
          {outage
            ? "Nothing is serving — the replacement has not started yet"
            : `${serving} of ${replicas} still serving through the replacement`}
        </text>

        <rect
          x={12}
          y={44}
          width={296}
          height={78}
          rx={11}
          className={styles.tierBoxIdle}
        />
        <text x={26} y={64} className={styles.tierRole}>
          apps pool · draining
        </text>
        <rect
          x={332}
          y={44}
          width={296}
          height={78}
          rx={11}
          className={styles.tierBox}
        />
        <text x={346} y={64} className={styles.tierRole}>
          infra pool · target
        </text>

        {Array.from({ length: replicas }, (_, i) => {
          const where = place(i);
          const x =
            where === "apps"
              ? 26 + i * 68
              : where === "infra"
                ? 346 + i * 68
                : 26 + i * 68 + 150;
          return (
            <g key={i}>
              <rect
                x={x}
                y={76}
                width={60}
                height={32}
                rx={7}
                className={
                  where === "moving" ? styles.podPending : styles.podReady
                }
                style={{
                  transition: animate
                    ? "x 900ms cubic-bezier(0.16,1,0.3,1)"
                    : undefined,
                }}
              />
              <text x={x + 8} y={96} className={styles.podText}>
                {where === "moving" ? "starting" : `pod ${i + 1}`}
              </text>
            </g>
          );
        })}

        <text x={12} y={156} className={styles.label}>
          Served during the window
        </text>
        <rect
          x={12}
          y={166}
          width={420}
          height={16}
          rx={4}
          className={styles.barTrack}
        />
        <rect
          x={12}
          y={166}
          width={(serving / replicas) * 420}
          height={16}
          rx={4}
          className={outage ? styles.barShort : styles.barServed}
          style={{ transition: animate ? "width 600ms ease-out" : undefined }}
        />
        <text x={444} y={179} className={outage ? styles.monoBad : styles.mono}>
          {Math.round((serving / replicas) * 100)}%
        </text>

        <text x={12} y={204} className={styles.label}>
          {replicas === 1
            ? "A single replica has no one to hand the traffic to. The drain is an outage you scheduled."
            : "The remaining replicas absorb the traffic, so the same operation is a non-event."}
        </text>
      </svg>
    </div>
  );
}

// ── Canary traffic share ───────────────────────────────────────────────────

export function CanarySplit({
  animate,
  value = 2,
}: {
  animate: boolean;
  value?: number;
}) {
  const canary = Math.max(0, Math.min(4, Math.round(value)));
  const stable = 6;
  const total = stable + canary;
  const sharePct = Math.round((canary / total) * 100);
  // A canary failing 38% of what it receives — the shape of the canary-catch drill's fault.
  const canaryErrorPct = 38;
  const blended = (sharePct / 100) * canaryErrorPct;
  const t = useLoopedProgress(2800, animate);

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 208"
        role="img"
        aria-label={`Six stable replicas and ${canary} canary replicas: ${sharePct} percent exposure and a blended error rate near ${blended.toFixed(1)} percent.`}
      >
        <text x={12} y={22} className={styles.labelStrong}>
          Exposure is replica share
        </text>

        <rect
          x={12}
          y={80}
          width={100}
          height={44}
          rx={9}
          className={styles.tierBox}
        />
        <text x={26} y={98} className={styles.tierRole}>
          admission
        </text>
        <text x={26} y={114} className={styles.tierName}>
          Envoy
        </text>

        <path
          d="M 112 96 C 156 96, 164 58, 208 58"
          className={animate ? styles.linkLive : styles.link}
        />
        {canary > 0 && (
          <path
            d="M 112 110 C 156 110, 164 150, 208 150"
            className={animate ? styles.linkLive : styles.link}
          />
        )}

        <text x={208} y={42} className={styles.label}>
          stable · {stable} replicas · {100 - sharePct}%
        </text>
        {Array.from({ length: stable }, (_, i) => (
          <rect
            key={`s${i}`}
            x={208 + i * 44}
            y={48}
            width={36}
            height={26}
            rx={6}
            className={styles.podReady}
          />
        ))}

        <text x={208} y={136} className={styles.label}>
          canary · {canary} replicas · {sharePct}%
        </text>
        {canary === 0 ? (
          <text x={208} y={160} className={styles.monoDim}>
            aborted — no traffic on the candidate build
          </text>
        ) : (
          Array.from({ length: canary }, (_, i) => (
            <rect
              key={`c${i}`}
              x={208 + i * 44}
              y={142}
              width={36}
              height={26}
              rx={6}
              className={styles.podFailing}
            />
          ))
        )}

        {animate &&
          canary > 0 &&
          [0, 1, 2].map((i) => {
            const phase = (t + i / 3) % 1;
            const onCanary = i === 0;
            const y1 = onCanary ? 150 : 58;
            const y0 = onCanary ? 110 : 96;
            return (
              <circle
                key={i}
                cx={112 + (208 - 112) * phase}
                cy={y0 + (y1 - y0) * phase}
                r={3}
                className={onCanary ? styles.packetDropped : styles.packet}
              />
            );
          })}

        <text x={12} y={192} className={styles.label}>
          Canary failing {canaryErrorPct}% of what it receives →
        </text>
        <text
          x={286}
          y={192}
          className={blended > 1 ? styles.monoBad : styles.mono}
        >
          {blended.toFixed(1)}% blended
        </text>
        <text x={392} y={192} className={styles.label}>
          against a 1% objective
        </text>
      </svg>
    </div>
  );
}

// ── Objective conditions and the hold window ───────────────────────────────

const HOLD_SECONDS = 20;

export function GoalHold({ animate }: { animate: boolean }) {
  // Runs the honest sequence: two of three met, then all three, then a break that restarts the
  // window, then a clean hold. That break is the part the lesson is about.
  const [tick, setTick] = useState(HOLD_SECONDS);

  useEffect(() => {
    if (!animate) return;
    const reset = window.setTimeout(() => setTick(0), 0);
    const id = window.setInterval(
      () => setTick((n) => (n >= HOLD_SECONDS + 6 ? 0 : n + 1)),
      400,
    );
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(id);
    };
  }, [animate]);
  const visibleTick = animate ? tick : HOLD_SECONDS;

  // A single-sample break in the middle, to show the window restarting rather than pausing.
  const broke = visibleTick > 8 && visibleTick < 10;
  const held =
    visibleTick < 8
      ? visibleTick
      : broke
        ? 0
        : Math.min(HOLD_SECONDS, visibleTick - 10);
  const allMet = !broke && visibleTick >= 2;

  const conditions = [
    { label: "Served ≥ 640/s", value: allMet ? "648/s" : "512/s", met: allMet },
    { label: "p95 < 250 ms", value: broke ? "268 ms" : "164 ms", met: !broke },
    { label: "Errors < 1%", value: "0.3%", met: true },
  ];

  return (
    <div className={styles.stage}>
      <svg
        viewBox="0 0 640 208"
        role="img"
        aria-label={`Objective: ${conditions.filter((c) => c.met).length} of 3 conditions met, held for ${held} of ${HOLD_SECONDS} seconds.`}
      >
        <text x={12} y={22} className={styles.labelStrong}>
          Resolved means every condition, held continuously
        </text>

        {conditions.map((c, i) => (
          <g key={c.label}>
            <rect
              x={12}
              y={40 + i * 38}
              width={470}
              height={30}
              rx={7}
              className={c.met ? styles.podReady : styles.podFailing}
            />
            <text x={26} y={60 + i * 38} className={styles.podText}>
              {c.met ? "MET" : "NOT MET"}
            </text>
            <text x={86} y={60 + i * 38} className={styles.label}>
              {c.label}
            </text>
            <text
              x={392}
              y={60 + i * 38}
              className={c.met ? styles.mono : styles.monoBad}
            >
              {c.value}
            </text>
          </g>
        ))}

        <text x={12} y={178} className={styles.label}>
          Verification window
        </text>
        <rect
          x={148}
          y={166}
          width={334}
          height={16}
          rx={4}
          className={styles.barTrack}
        />
        <rect
          x={148}
          y={166}
          width={(held / HOLD_SECONDS) * 334}
          height={16}
          rx={4}
          className={styles.barServed}
        />
        <text x={494} y={179} className={styles.mono}>
          {held}s / {HOLD_SECONDS}s
        </text>

        <text x={12} y={200} className={styles.label}>
          {broke
            ? "One condition broke — the window restarts from zero, because 'held with a gap' is not held."
            : "Every condition satisfied, and counting. A single bad sample sends this back to zero."}
        </text>
      </svg>
    </div>
  );
}
