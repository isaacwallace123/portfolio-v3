"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  CircleSlash,
  Cpu,
  Database,
  Gauge,
  Layers,
  Loader2,
  Lock,
  MemoryStick,
  PartyPopper,
  Play,
  Radio,
  Server,
  SlidersHorizontal,
  Square,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AUTH_URL, HOMELAB_URL } from "@iw/core";
import { homelabScenarios } from "@/entities/scenario";
import {
  createLiveRun,
  endDrill,
  fetchComponents,
  fetchLiveStatus,
  fetchPlatformStatus,
  fetchRunEvents,
  getLiveRun,
  getLiveTrace,
  liveDecision,
  practiceAction,
  startDrill,
  teardownLiveRun,
  type ClusterEvent,
  type LivePlatformStatus,
  type LiveRunView,
  type LiveStatus,
  type LiveTrace,
  type RunComponent,
} from "@/shared/lib/liveClient";
import styles from "./ClusterWorkbench.module.css";

const SANDBOX = "practice-cluster";
const POLL_MS = 2500;
const HISTORY = 40; // ~100s of samples at the poll interval

const drills = homelabScenarios.filter((s) => s.id !== SANDBOX);

// The request graph. Explicit 1-based grid coordinates: the request tiers run along row 2, the data
// tier stacks in column 4 with Postgres above and Redis below.
const NODES = [
  { id: "k6", label: "k6", role: "load generator", icon: Zap, col: 1, row: 2 },
  { id: "envoy", label: "Envoy", role: "gateway", icon: Radio, col: 2, row: 2 },
  {
    id: "checkout",
    label: "checkout",
    role: "API",
    icon: Server,
    col: 3,
    row: 2,
  },
  {
    id: "postgres",
    label: "Postgres",
    role: "database",
    icon: Database,
    col: 4,
    row: 1,
  },
  {
    id: "redis",
    label: "Redis",
    role: "cache",
    icon: Database,
    col: 4,
    row: 3,
  },
] as const;

const EDGES: [string, string][] = [
  ["k6", "envoy"],
  ["envoy", "checkout"],
  ["checkout", "postgres"],
  ["checkout", "redis"],
];

const withReplicas = (r: LiveRunView, n: number): LiveRunView => ({
  ...r,
  telemetry: { ...r.telemetry, apiReplicas: n },
});
const withCache = (r: LiveRunView, on: boolean): LiveRunView => ({
  ...r,
  telemetry: { ...r.telemetry, cacheActive: on },
});

// Allowlisted cluster controls. `apply` mirrors the broker's effect locally so a segment reflects the
// new state the instant it is clicked, rather than waiting a poll for the round trip.
const CONTROLS = [
  {
    label: "Checkout replicas",
    hint: "Each replica adds CPU, so capacity scales and p95 falls under load.",
    active: (r: LiveRunView) =>
      r.telemetry.apiReplicas <= 1
        ? "scale-1"
        : r.telemetry.apiReplicas >= 6
          ? "scale-6"
          : "scale-3",
    options: [
      {
        id: "scale-1",
        label: "1",
        apply: (r: LiveRunView) => withReplicas(r, 1),
      },
      {
        id: "scale-3",
        label: "3",
        apply: (r: LiveRunView) => withReplicas(r, 3),
      },
      {
        id: "scale-6",
        label: "6",
        apply: (r: LiveRunView) => withReplicas(r, 6),
      },
    ],
  },
  {
    label: "Cache tier",
    hint: "Redis in front of Postgres. A cache hit skips the request's work entirely.",
    active: (r: LiveRunView) =>
      r.telemetry.cacheActive ? "cache-on" : "cache-off",
    options: [
      {
        id: "cache-off",
        label: "Off",
        apply: (r: LiveRunView) => withCache(r, false),
      },
      {
        id: "cache-on",
        label: "On",
        apply: (r: LiveRunView) => withCache(r, true),
      },
    ],
  },
  {
    label: "Release track",
    hint: "The candidate build carries a real slow, occasionally failing pricing path.",
    active: (r: LiveRunView) => `release-${r.releaseTrack}`,
    options: [
      {
        id: "release-stable",
        label: "Stable",
        apply: (r: LiveRunView) => ({ ...r, releaseTrack: "stable" as const }),
      },
      {
        id: "release-candidate",
        label: "Candidate",
        apply: (r: LiveRunView) => ({
          ...r,
          releaseTrack: "candidate" as const,
        }),
      },
    ],
  },
  {
    label: "Traffic",
    hint: "The k6 load generator driving real requests through the gateway.",
    active: (r: LiveRunView) => (r.loadEnabled ? "traffic-on" : "traffic-off"),
    options: [
      {
        id: "traffic-off",
        label: "Off",
        apply: (r: LiveRunView) => ({ ...r, loadEnabled: false }),
      },
      {
        id: "traffic-on",
        label: "On",
        apply: (r: LiveRunView) => ({ ...r, loadEnabled: true }),
      },
    ],
  },
  {
    label: "Worker pool",
    hint: "Which node pool the checkout replicas are scheduled onto.",
    active: (r: LiveRunView) => `move-${r.targetPool}`,
    options: [
      {
        id: "move-apps",
        label: "Apps",
        apply: (r: LiveRunView) => ({ ...r, targetPool: "apps" as const }),
      },
      {
        id: "move-infra",
        label: "Infra",
        apply: (r: LiveRunView) => ({ ...r, targetPool: "infra" as const }),
      },
    ],
  },
] as const;

function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** A line chart of real measured samples — a trend, not a dashboard. */
function Spark({
  series,
  label,
  unit,
}: {
  series: number[];
  label: string;
  unit: string;
}) {
  const max = Math.max(1, ...series);
  const last = series.at(-1) ?? 0;
  const w = 260;
  const h = 40;
  const d =
    series.length < 2
      ? ""
      : series
          .map((v, i) => {
            const x = (i / (series.length - 1)) * w;
            const y = h - (v / max) * (h - 4) - 2;
            return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(" ");

  return (
    <div className={styles.spark}>
      <div className={styles.sparkTop}>
        <span>{label}</span>
        <b>
          {last}
          {unit}
        </b>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {d && (
          <>
            <path
              d={`${d} L ${w} ${h} L 0 ${h} Z`}
              className={styles.sparkFill}
            />
            <path d={d} className={styles.sparkLine} />
          </>
        )}
      </svg>
      <small>
        peak {max}
        {unit} · {series.length} samples
      </small>
    </div>
  );
}

/** Purely decorative celebration for a solved drill: random confetti plus a few firework bursts.
    Generated once per mount so the randomness does not resample on every poll. */
function Celebration() {
  const [pieces] = useState(() =>
    Array.from({ length: 90 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 1400,
      duration: 2200 + Math.random() * 2200,
      drift: Math.random() * 160 - 80,
      spin: Math.random() * 900 - 450,
      size: 5 + Math.random() * 7,
      hue: Math.floor(Math.random() * 3),
    })),
  );
  const [bursts] = useState(() =>
    Array.from({ length: 4 }, (_, i) => ({
      x: 18 + Math.random() * 64,
      y: 18 + Math.random() * 42,
      delay: i * 420 + Math.random() * 220,
      sparks: Array.from({ length: 16 }, (_, k) => ({
        angle: (k / 16) * 360 + Math.random() * 12,
        distance: 70 + Math.random() * 70,
      })),
    })),
  );

  return (
    <div className={styles.celebration} aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={styles[`c${p.hue}` as keyof typeof styles]}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      {bursts.map((b, i) => (
        <span
          key={i}
          className={styles.burst}
          style={{ left: `${b.x}%`, top: `${b.y}%` }}
        >
          {b.sparks.map((s, k) => (
            <em
              key={k}
              style={
                {
                  animationDelay: `${b.delay}ms`,
                  "--angle": `${s.angle}deg`,
                  "--dist": `${s.distance}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}

type Tab = "drills" | "controls" | "activity";
const TABS: { id: Tab; icon: typeof Gauge; label: string }[] = [
  { id: "drills", icon: Gauge, label: "Drills" },
  { id: "controls", icon: SlidersHorizontal, label: "Controls" },
  { id: "activity", icon: Layers, label: "Activity" },
];

export default function ClusterWorkbench() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [components, setComponents] = useState<RunComponent[]>([]);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [history, setHistory] = useState<
    Record<string, { cpu: number; mem: number }[]>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drills");

  const poll = useRef<number | null>(null);
  // Every mutation bumps this. A refresh captures it before fetching and drops its run payload if a
  // mutation happened meanwhile — otherwise an in-flight poll lands after an action and reverts it.
  const mutationSeq = useRef(0);

  // ── edges measured from the real node boxes, so the graph is correct at any width ──
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({});
  // Each replica square is its own edge target, so the gateway visibly fans out to every pod.
  const replicaRefs = useRef<Record<string, HTMLElement | null>>({});
  const [paths, setPaths] = useState<{ id: string; d: string }[]>([]);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = canvas.getBoundingClientRect();
    const next: { id: string; d: string }[] = [];
    const curve = (a: DOMRect, b: DOMRect, id: string) => {
      const x1 = a.right - base.left;
      const y1 = a.top + a.height / 2 - base.top;
      const x2 = b.left - base.left;
      const y2 = b.top + b.height / 2 - base.top;
      const dx = Math.max(24, (x2 - x1) * 0.5);
      next.push({
        id,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
    };

    for (const [from, to] of EDGES) {
      const a = nodeRefs.current[from]?.getBoundingClientRect();
      const b = nodeRefs.current[to]?.getBoundingClientRect();
      if (!a || !b) continue;
      // The gateway load-balances per request, so draw it reaching each checkout replica rather
      // than the box as a whole — the fan-out is the point of scaling.
      if (from === "envoy" && to === "checkout") {
        const squares = Object.entries(replicaRefs.current).filter(
          ([k, el]) => k.startsWith("checkout:") && el,
        );
        if (squares.length > 0) {
          for (const [k, el] of squares)
            curve(a, el!.getBoundingClientRect(), `envoy-${k}`);
          continue;
        }
      }
      curve(a, b, `${from}-${to}`);
    }
    setPaths(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, components, run?.runId]);

  // ── data ──────────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (poll.current !== null) {
      window.clearInterval(poll.current);
      poll.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const refresh = useCallback(async (runId: string) => {
    const seq = mutationSeq.current;
    const [view, comps, evts, tr] = await Promise.all([
      getLiveRun(runId),
      fetchComponents(runId).catch(() => [] as RunComponent[]),
      fetchRunEvents(runId).catch(() => [] as ClusterEvent[]),
      getLiveTrace(runId).catch(() => null),
    ]);
    // Measured data is always safe to apply; desired state is not if it raced a mutation.
    if (seq === mutationSeq.current) setRun(view);
    setComponents(comps);
    setEvents(evts);
    if (tr) setTrace(tr);
    setHistory((prev) => {
      const next = { ...prev };
      for (const c of comps) {
        next[c.name] = [
          ...(next[c.name] ?? []),
          { cpu: c.cpuMillicores, mem: c.memoryMiB },
        ].slice(-HISTORY);
      }
      return next;
    });
  }, []);

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      poll.current = window.setInterval(() => {
        refresh(runId).catch(() => stopPolling());
      }, POLL_MS);
    },
    [refresh, stopPolling],
  );

  // Resume the cluster this account already owns. The first paint is a skeleton rather than the
  // launch screen, so a reload never flashes "provision a cluster" at someone who already has one.
  useEffect(() => {
    let alive = true;
    fetchLiveStatus()
      .then(async (s) => {
        if (!alive) return;
        if (s.myRunId) {
          await refresh(s.myRunId).catch(() => undefined);
          if (!alive) return;
          startPolling(s.myRunId);
        }
        setStatus(s);
      })
      .catch(() => {
        if (alive)
          setStatus({
            enabled: false,
            signedIn: false,
            displayName: null,
            myRunId: null,
          });
      });
    fetchPlatformStatus()
      .then((p) => alive && setPlatform(p))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refresh, startPolling]);

  const act = useCallback(
    async (
      key: string,
      fn: () => Promise<LiveRunView | void>,
      optimistic?: (r: LiveRunView) => LiveRunView,
    ) => {
      setBusy(key);
      setError(null);
      mutationSeq.current += 1;
      if (optimistic) setRun((r) => (r ? optimistic(r) : r));
      try {
        const next = await fn();
        mutationSeq.current += 1;
        if (next) setRun(next as LiveRunView);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That action was rejected.");
        mutationSeq.current += 1;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const provision = useCallback(async () => {
    setBusy("provision");
    setError(null);
    try {
      const created = await createLiveRun(SANDBOX);
      setRun(created);
      startPolling(created.runId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not provision a cluster.",
      );
    } finally {
      setBusy(null);
    }
  }, [startPolling]);

  const teardown = useCallback(async () => {
    if (!run) return;
    setBusy("teardown");
    try {
      await teardownLiveRun(run.runId);
      stopPolling();
      setRun(null);
      setComponents([]);
      setEvents([]);
      setTrace(null);
      setHistory({});
      setSelected(null);
      fetchPlatformStatus()
        .then(setPlatform)
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Teardown failed.");
    } finally {
      setBusy(null);
    }
  }, [run, stopPolling]);

  const byName = (n: string) => components.find((c) => c.name === n);

  // ── first paint: resolving the session ────────────────────────────────────
  if (status === null) {
    return (
      <div className={styles.shell}>
        <div className={styles.booting}>
          <Loader2 size={18} className={styles.spin} />
          <span>Looking for your cluster…</span>
        </div>
      </div>
    );
  }

  // ── no cluster yet ────────────────────────────────────────────────────────
  if (!run) {
    const slots = platform?.slotsAvailable ?? null;
    const signInUrl = `${AUTH_URL}/login?returnUrl=${encodeURIComponent(
      `${HOMELAB_URL}/practice`,
    )}`;

    return (
      <div className={styles.shell}>
        <div className={styles.empty}>
          <p className={styles.kicker}>
            <Radio size={14} /> Real cluster control
          </p>
          <h1>Build a cluster. Then break it.</h1>
          <p className={styles.lede}>
            Provision a disposable Kubernetes workspace on the live homelab — an
            isolated namespace running a checkout API, Postgres, Redis, an Envoy
            gateway and a k6 load generator. Operate it freely, or run a drill
            on it and work a real incident.
          </p>
          <ul className={styles.included}>
            <li>
              <Server size={15} /> Isolated namespace, quota and default-deny
              network policy
            </li>
            <li>
              <Activity size={15} /> Every metric measured from the running
              workload
            </li>
            <li>
              <Lock size={15} /> Private to your account — one cluster at a time
            </li>
            <li>
              <Timer size={15} /> Self-destructs after 15 minutes
            </li>
          </ul>

          {status.signedIn ? (
            <button
              className={styles.primary}
              onClick={provision}
              disabled={!status.enabled || busy !== null || slots === 0}
            >
              {busy === "provision" ? (
                <Loader2 size={16} className={styles.spin} />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {busy === "provision"
                ? "Provisioning…"
                : !status.enabled
                  ? "Live control offline"
                  : slots === 0
                    ? "All cluster slots busy"
                    : "Provision cluster"}
            </button>
          ) : (
            <a className={styles.primary} href={signInUrl}>
              <Lock size={16} /> Sign in to provision
            </a>
          )}

          {platform && (
            <p className={styles.capacity}>
              {platform.nodesReady}/{platform.nodesTotal} nodes ready ·{" "}
              {platform.slotsAvailable}/{platform.maxConcurrentRuns} cluster
              slots free
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    );
  }

  // ── live cluster ──────────────────────────────────────────────────────────
  const t = run.telemetry;
  const drill = run.drillId ? drills.find((d) => d.id === run.drillId) : null;
  const provisioning = run.status === "provisioning";
  const flowing = run.loadEnabled && t.requestsPerSec > 0;
  const selectedNode = NODES.find((n) => n.id === selected);
  const selectedComp = selected ? byName(selected) : undefined;
  const totalCpu = components.reduce((a, c) => a + c.cpuMillicores, 0);
  const totalMem = components.reduce((a, c) => a + c.memoryMiB, 0);

  return (
    <div className={styles.shell}>
      {run.drillSolved && <Celebration />}

      <div className={styles.body}>
        <div className={styles.canvas} ref={canvasRef}>
          {/* the canvas carries its own chrome — no second navbar */}
          <div className={styles.hudTopLeft}>
            <span
              className={`${styles.dot} ${provisioning ? styles.dotWarn : styles.dotOk}`}
            />
            <b>Practice cluster</b>
            <code>{run.namespace ?? run.runId}</code>
            {drill && <span className={styles.drillTag}>{run.drillTitle}</span>}
          </div>

          <div className={styles.hudTopRight}>
            <span title="Time until automatic teardown">
              <Timer size={13} /> {clock(run.remainingTtlMs)}
            </span>
            <button
              className={styles.danger}
              onClick={teardown}
              disabled={busy !== null}
            >
              {busy === "teardown" ? (
                <Loader2 size={13} className={styles.spin} />
              ) : (
                <Trash2 size={13} />
              )}
              Tear down
            </button>
          </div>

          <svg className={styles.edges} aria-hidden="true">
            {paths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                className={`${styles.edge} ${flowing ? styles.edgeLive : ""}`}
              />
            ))}
          </svg>

          <div className={styles.graph}>
            {NODES.map((n) => {
              const c = byName(n.id);
              const desired = c?.desired ?? 0;
              const ready = c?.ready ?? 0;
              const off = desired === 0;
              const starting = desired > 0 && ready < desired;
              const limit = c?.cpuLimitMillicoresPerPod ?? 0;
              const Icon = n.icon;
              return (
                <button
                  key={n.id}
                  ref={(el) => {
                    nodeRefs.current[n.id] = el;
                  }}
                  className={`${styles.node} ${off ? styles.nodeOff : ""} ${
                    selected === n.id ? styles.nodeActive : ""
                  }`}
                  style={{ gridColumn: n.col, gridRow: n.row }}
                  onClick={() => setSelected(selected === n.id ? null : n.id)}
                >
                  <span className={styles.nodeHead}>
                    <span className={styles.nodeIcon}>
                      <Icon size={14} />
                    </span>
                    <span className={styles.nodeTitle}>
                      <b>{n.label}</b>
                      <small>{n.role}</small>
                    </span>
                    <span
                      className={`${styles.badge} ${
                        off
                          ? styles.badgeOff
                          : starting
                            ? styles.badgeWarn
                            : styles.badgeOk
                      }`}
                    >
                      {off ? "off" : `${ready}/${desired}`}
                    </span>
                  </span>

                  {c && c.pods.length > 0 && (
                    <span className={styles.replicas}>
                      {c.pods.map((p) => {
                        const pct =
                          limit > 0
                            ? Math.min(100, (p.cpuMillicores / limit) * 100)
                            : 0;
                        return (
                          <span
                            key={p.name}
                            ref={(el) => {
                              replicaRefs.current[`${n.id}:${p.name}`] = el;
                            }}
                            className={`${styles.replica} ${!p.ready ? styles.replicaStarting : ""} ${
                              pct > 85 ? styles.replicaHot : ""
                            }`}
                            title={`${p.name} · ${p.cpuMillicores}m · ${p.memoryMiB}Mi${p.restarts ? ` · ${p.restarts} restarts` : ""}`}
                          >
                            {/* fill height tracks this replica's CPU against its own limit */}
                            <i style={{ height: `${Math.max(6, pct)}%` }} />
                            {!p.ready && <b className={styles.replicaSpin} />}
                          </span>
                        );
                      })}
                    </span>
                  )}

                  <span className={styles.nodeFoot}>
                    {off ? (
                      "not provisioned"
                    ) : starting ? (
                      <span className={styles.starting}>
                        <Loader2 size={10} className={styles.spin} /> starting
                      </span>
                    ) : (
                      <>
                        <span>
                          <Cpu size={10} /> {c?.cpuMillicores ?? 0}m
                        </span>
                        <span>
                          <MemoryStick size={10} /> {c?.memoryMiB ?? 0}Mi
                        </span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={styles.hudBottomLeft}>
            <span className={flowing ? styles.liveChip : styles.idleChip}>
              <i /> {flowing ? "traffic flowing" : "traffic stopped"}
            </span>
            <span>
              {run.podCount ?? 0} pods · {components.length} services
            </span>
            {trace && trace.spans.length > 0 && (
              <span>
                trace {trace.durationMs}ms · {trace.release}
              </span>
            )}
          </div>

          <div className={styles.hudBottomRight}>
            <div className={styles.stat}>
              <span>Throughput</span>
              <b>{t.requestsPerSec}/s</b>
            </div>
            <div
              className={`${styles.stat} ${t.p95LatencyMs > t.latencyTargetMs ? styles.statBad : ""}`}
            >
              <span>p95</span>
              <b>{t.p95LatencyMs}ms</b>
            </div>
            <div
              className={`${styles.stat} ${t.errorRatePct > 1 ? styles.statBad : ""}`}
            >
              <span>Errors</span>
              <b>{t.errorRatePct.toFixed(2)}%</b>
            </div>
            <div className={styles.stat}>
              <span>CPU</span>
              <b>{totalCpu}m</b>
            </div>
            <div className={styles.stat}>
              <span>Memory</span>
              <b>{totalMem}Mi</b>
            </div>
            <div className={styles.stat}>
              <span>SLO</span>
              <b>{t.score}</b>
            </div>
          </div>

          {error && (
            <p className={styles.errorFloat} role="alert">
              <AlertTriangle size={13} /> {error}
              <button onClick={() => setError(null)} aria-label="Dismiss">
                <X size={12} />
              </button>
            </p>
          )}
        </div>

        {/* ── inspector ── */}
        <aside className={styles.inspector}>
          {selectedNode ? (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <b>{selectedNode.label}</b>
                <button
                  className={styles.iconBtn}
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <p className={styles.panelSub}>{selectedNode.role}</p>

              {selectedComp && selectedComp.desired > 0 ? (
                <>
                  <div className={styles.kv}>
                    <span>Replicas</span>
                    <b>
                      {selectedComp.ready}/{selectedComp.desired}
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>CPU</span>
                    <b>{selectedComp.cpuMillicores}m</b>
                  </div>
                  <div className={styles.kv}>
                    <span>Per replica</span>
                    <b>
                      {selectedComp.pods.length
                        ? Math.round(
                            selectedComp.cpuMillicores /
                              selectedComp.pods.length,
                          )
                        : 0}
                      m / {selectedComp.cpuLimitMillicoresPerPod}m
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>Saturation</span>
                    <b>
                      {selectedComp.cpuLimitMillicoresPerPod &&
                      selectedComp.pods.length
                        ? Math.round(
                            (selectedComp.cpuMillicores /
                              (selectedComp.cpuLimitMillicoresPerPod *
                                selectedComp.pods.length)) *
                              100,
                          )
                        : 0}
                      %
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>Memory</span>
                    <b>{selectedComp.memoryMiB} MiB</b>
                  </div>
                  <div className={styles.kv}>
                    <span>Restarts</span>
                    <b>
                      {selectedComp.pods.reduce((a, p) => a + p.restarts, 0)}
                    </b>
                  </div>

                  <p className={styles.panelLabel}>Trend</p>
                  <Spark
                    label="CPU"
                    unit="m"
                    series={(history[selectedComp.name] ?? []).map(
                      (h) => h.cpu,
                    )}
                  />
                  <Spark
                    label="Memory"
                    unit="Mi"
                    series={(history[selectedComp.name] ?? []).map(
                      (h) => h.mem,
                    )}
                  />

                  <p className={styles.panelLabel}>Pods</p>
                  <div className={styles.podList}>
                    {selectedComp.pods.map((p) => (
                      <div key={p.name} className={styles.podItem}>
                        <span className={styles.podId}>…{p.name}</span>
                        <span>{p.cpuMillicores}m</span>
                        <span>{p.memoryMiB}Mi</span>
                        <span
                          className={p.ready ? styles.okText : styles.warnText}
                        >
                          {p.ready ? p.phase : "starting"}
                          {p.restarts > 0 ? ` ×${p.restarts}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>

                  {selected === "checkout" && trace?.spans.length ? (
                    <>
                      <p className={styles.panelLabel}>Latest trace</p>
                      <div className={styles.trace}>
                        {trace.spans.map((s) => (
                          <div key={s.spanId} className={styles.span}>
                            <span>{s.name}</span>
                            <div className={styles.spanBar}>
                              <i
                                className={
                                  s.status === "error" ? styles.spanErr : ""
                                }
                                style={{
                                  width: `${Math.max(2, Math.min(100, (s.durationMs / Math.max(1, trace.durationMs)) * 100))}%`,
                                }}
                              />
                            </div>
                            <b>{Math.round(s.durationMs)}ms</b>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <p className={styles.blank}>
                  This service is not provisioned right now.
                </p>
              )}
            </div>
          ) : (
            <div className={styles.panel}>
              <div className={styles.tabs}>
                {TABS.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    className={tab === id ? styles.tabOn : ""}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>

              {tab === "drills" &&
                (!drill ? (
                  <>
                    <p className={styles.hint}>
                      A drill sets an objective and a clock on this cluster and
                      unlocks its operator decisions. Nothing is reprovisioned —
                      the workload stays up.
                    </p>
                    <div className={styles.drills}>
                      {drills.map((d, i) => (
                        <button
                          key={d.id}
                          className={styles.drillItem}
                          onClick={() =>
                            act(`drill-${d.id}`, () =>
                              startDrill(run.runId, d.id),
                            )
                          }
                          disabled={busy !== null || provisioning}
                        >
                          <span className={styles.drillNo}>
                            {busy === `drill-${d.id}` ? (
                              <Loader2 size={12} className={styles.spin} />
                            ) : (
                              String(i + 1).padStart(2, "0")
                            )}
                          </span>
                          <span>
                            <b>{d.title}</b>
                            <small>{d.summary}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                    {provisioning && (
                      <p className={styles.hint}>
                        Drills unlock once the workload is serving traffic.
                      </p>
                    )}
                  </>
                ) : run.drillSolved ? (
                  <div className={styles.solved}>
                    <span className={styles.solvedIcon}>
                      <PartyPopper size={22} />
                    </span>
                    <b>Drill complete</b>
                    <p className={styles.solvedName}>
                      {run.drillTitle || drill.title}
                    </p>
                    <div className={styles.scoreRow}>
                      <div>
                        <span>Correct</span>
                        <b>
                          {run.drillCorrectChosen}/{run.drillCorrectTotal}
                        </b>
                      </div>
                      <div>
                        <span>Missteps</span>
                        <b
                          className={
                            run.drillWrongChosen ? styles.warnText : ""
                          }
                        >
                          {run.drillWrongChosen}
                        </b>
                      </div>
                      <div>
                        <span>Time</span>
                        <b>{clock(run.elapsedMs)}</b>
                      </div>
                    </div>
                    <p className={styles.solvedSub}>
                      The cluster is still yours — run another drill on it, or
                      keep experimenting with the controls.
                    </p>
                    <button
                      className={styles.primarySm}
                      onClick={() => act("end", () => endDrill(run.runId))}
                      disabled={busy !== null}
                    >
                      {busy === "end" ? (
                        <Loader2 size={14} className={styles.spin} />
                      ) : (
                        <Gauge size={14} />
                      )}
                      Choose another drill
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.objective}>
                      <b>{run.drillTitle || drill.title}</b>
                      <p>{run.drillObjective || drill.summary}</p>
                      <span>
                        {clock(run.elapsedMs)} / {clock(run.durationMs)} ·{" "}
                        {run.drillCorrectChosen}/{run.drillCorrectTotal} correct
                      </span>
                    </div>
                    <div className={styles.progress}>
                      <i
                        style={{
                          width: `${Math.min(100, (run.elapsedMs / Math.max(1, run.durationMs)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className={styles.qHint}>
                      Pick the actions you think resolve this. Every option is
                      really applied to your cluster — watch the measured
                      signals to see whether it worked.
                    </p>
                    <div className={styles.decisions}>
                      {run.drillOptions.map((o) => {
                        const answered = o.chosen;
                        const right = o.isCorrect === true;
                        const pending = busy === `dec-${o.id}`;
                        return (
                          <div key={o.id} className={styles.qWrap}>
                            <button
                              className={`${styles.decision} ${
                                answered
                                  ? right
                                    ? styles.qRight
                                    : styles.qWrong
                                  : ""
                              } ${pending ? styles.pending : ""}`}
                              onClick={() =>
                                act(`dec-${o.id}`, () =>
                                  liveDecision(run.runId, o.id),
                                )
                              }
                              disabled={
                                !o.unlocked || answered || busy !== null
                              }
                            >
                              {pending || !o.unlocked ? (
                                <Loader2 size={14} className={styles.spin} />
                              ) : answered ? (
                                right ? (
                                  <Check size={14} />
                                ) : (
                                  <AlertTriangle size={14} />
                                )
                              ) : (
                                <Gauge size={14} />
                              )}
                              <span>
                                <b>{o.label}</b>
                                <small>
                                  {pending
                                    ? "Applying to the cluster…"
                                    : !o.unlocked
                                      ? `Collecting a baseline from live traffic — unlocks in ${o.unlocksInSeconds}s`
                                      : o.description}
                                </small>
                              </span>
                            </button>
                            {answered && o.explanation && (
                              <p
                                className={`${styles.qWhy} ${right ? styles.qWhyOk : styles.qWhyBad}`}
                              >
                                {o.explanation}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className={styles.ghost}
                      onClick={() => act("end", () => endDrill(run.runId))}
                      disabled={busy !== null}
                    >
                      {busy === "end" ? (
                        <Loader2 size={12} className={styles.spin} />
                      ) : (
                        <Square size={12} />
                      )}
                      End drill, keep cluster
                    </button>
                  </>
                ))}

              {tab === "controls" && (
                <div className={styles.controls}>
                  {CONTROLS.map((g) => {
                    const activeId = g.active(run);
                    return (
                      <div key={g.label} className={styles.control}>
                        <label>{g.label}</label>
                        <div className={styles.segments}>
                          {g.options.map((o) => (
                            <button
                              key={o.id}
                              className={`${activeId === o.id ? styles.segOn : ""} ${busy === o.id ? styles.pending : ""}`}
                              onClick={() =>
                                act(
                                  o.id,
                                  () => practiceAction(run.runId, o.id),
                                  o.apply,
                                )
                              }
                              disabled={busy !== null || activeId === o.id}
                            >
                              {busy === o.id ? (
                                <Loader2 size={12} className={styles.spin} />
                              ) : (
                                o.label
                              )}
                            </button>
                          ))}
                        </div>
                        <small>{g.hint}</small>
                      </div>
                    );
                  })}
                  <p className={styles.note}>
                    <Lock size={12} /> Private to your account.{" "}
                    <CircleSlash size={12} /> Egress denied by default.
                  </p>
                </div>
              )}

              {tab === "activity" && (
                <div className={styles.events}>
                  {events.length === 0 ? (
                    <p className={styles.blank}>
                      {provisioning
                        ? "Scheduling workloads…"
                        : "No recent events."}
                    </p>
                  ) : (
                    events
                      .slice()
                      .reverse()
                      .map((e) => (
                        <article key={e.id} className={styles.event}>
                          <i
                            className={
                              e.severity === "warning"
                                ? styles.evWarn
                                : styles.evOk
                            }
                          />
                          <div>
                            <p>
                              <b>{e.reason}</b>
                              <span>
                                {e.objectKind} · {ago(e.at)}
                              </span>
                            </p>
                            <small>{e.message}</small>
                          </div>
                        </article>
                      ))
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
