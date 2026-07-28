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
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Cpu,
  Database,
  Gauge,
  Layers,
  Lock,
  MemoryStick,
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
  getLiveReport,
  getLiveRun,
  getLiveTrace,
  liveDecision,
  practiceAction,
  startDrill,
  teardownLiveRun,
  type ClusterEvent,
  type LivePlatformStatus,
  type LiveReport,
  type LiveRunView,
  type LiveStatus,
  type LiveTrace,
  type RunComponent,
} from "@/shared/lib/liveClient";
import styles from "./ClusterWorkbench.module.css";

const SANDBOX = "practice-cluster";
const drills = homelabScenarios.filter((s) => s.id !== SANDBOX);

// Canvas layout: which service sits in which column/row, and how the request flows between them.
// The graph is fixed (it is the scenario's architecture); only its live state changes.
// Explicit 1-based grid rows. The data tier stacks in column 4: Postgres above, Redis below, with
// the request tiers centred on row 2 between them.
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

const controlGroups = [
  {
    label: "Checkout replicas",
    hint: "Each replica adds CPU, so capacity scales and p95 falls under load.",
    options: [
      {
        id: "scale-1",
        label: "1",
        apply: (r: LiveRunView) => ({
          ...r,
          telemetry: { ...r.telemetry, apiReplicas: 1 },
        }),
      },
      {
        id: "scale-3",
        label: "3",
        apply: (r: LiveRunView) => ({
          ...r,
          telemetry: { ...r.telemetry, apiReplicas: 3 },
        }),
      },
      {
        id: "scale-6",
        label: "6",
        apply: (r: LiveRunView) => ({
          ...r,
          telemetry: { ...r.telemetry, apiReplicas: 6 },
        }),
      },
    ],
    active: (r: LiveRunView) =>
      r.telemetry.apiReplicas <= 1
        ? "scale-1"
        : r.telemetry.apiReplicas >= 6
          ? "scale-6"
          : "scale-3",
  },
  {
    label: "Cache tier",
    hint: "Redis in front of Postgres. Cache hits skip the request's work entirely.",
    options: [
      {
        id: "cache-off",
        label: "Off",
        apply: (r: LiveRunView) => ({
          ...r,
          telemetry: { ...r.telemetry, cacheActive: false },
        }),
      },
      {
        id: "cache-on",
        label: "On",
        apply: (r: LiveRunView) => ({
          ...r,
          telemetry: { ...r.telemetry, cacheActive: true },
        }),
      },
    ],
    active: (r: LiveRunView) =>
      r.telemetry.cacheActive ? "cache-on" : "cache-off",
  },
  {
    label: "Release track",
    hint: "The candidate build has a real slow, occasionally failing pricing path.",
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
    active: (r: LiveRunView) => `release-${r.releaseTrack}`,
  },
  {
    label: "Traffic",
    hint: "The k6 load generator driving real requests through the gateway.",
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
    active: (r: LiveRunView) => (r.loadEnabled ? "traffic-on" : "traffic-off"),
  },
  {
    label: "Worker pool",
    hint: "Which node pool the checkout replicas are scheduled onto.",
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
    active: (r: LiveRunView) => `move-${r.targetPool}`,
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

type Tab = "drills" | "controls" | "activity";

/** A small line chart of real measured samples (no axes — it is a trend, not a dashboard). */
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
  const h = 42;
  const pts = series.length < 2 ? [] : series;
  const d = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
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
        {d ? (
          <>
            <path
              d={`${d} L ${w} ${h} L 0 ${h} Z`}
              className={styles.sparkFill}
            />
            <path d={d} className={styles.sparkLine} />
          </>
        ) : null}
      </svg>
      <small>
        peak {max}
        {unit} · last {series.length} samples
      </small>
    </div>
  );
}

export default function ClusterWorkbench() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [components, setComponents] = useState<RunComponent[]>([]);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [report, setReport] = useState<LiveReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drills");
  const poll = useRef<number | null>(null);
  // Every mutation bumps this. A refresh captures it before fetching and discards its run payload if
  // a mutation happened meanwhile — otherwise an in-flight poll lands after the action and briefly
  // reverts the control the operator just clicked.
  const mutationSeq = useRef(0);
  // Rolling history of measured samples per service, so the inspector can graph real trends.
  const [history, setHistory] = useState<
    Record<string, { cpu: number; mem: number }[]>
  >({});

  // ── edge geometry: measure node boxes and draw curves between them ────────
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const [paths, setPaths] = useState<{ id: string; d: string }[]>([]);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = canvas.getBoundingClientRect();
    const next: { id: string; d: string }[] = [];
    for (const [from, to] of EDGES) {
      const a = nodeRefs.current[from]?.getBoundingClientRect();
      const b = nodeRefs.current[to]?.getBoundingClientRect();
      if (!a || !b) continue;
      const x1 = a.right - base.left;
      const y1 = a.top + a.height / 2 - base.top;
      const x2 = b.left - base.left;
      const y2 = b.top + b.height / 2 - base.top;
      const dx = Math.max(28, (x2 - x1) * 0.5);
      next.push({
        id: `${from}-${to}`,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
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
  }, [measure, components.length, run?.runId]);

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
    // Measured data is always safe to apply; the run's desired state is not if it raced a mutation.
    if (seq === mutationSeq.current) setRun(view);
    setComponents(comps);
    setEvents(evts);
    setHistory((prev) => {
      const next = { ...prev };
      for (const c of comps) {
        const series = [
          ...(next[c.name] ?? []),
          { cpu: c.cpuMillicores, mem: c.memoryMiB },
        ];
        next[c.name] = series.slice(-40); // ~100s of history at the 2.5s poll
      }
      return next;
    });
    if (tr) setTrace(tr);
    setReport(
      view.drillComplete ? await getLiveReport(runId).catch(() => null) : null,
    );
  }, []);

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      poll.current = window.setInterval(() => {
        refresh(runId).catch(() => stopPolling());
      }, 2500);
    },
    [refresh, stopPolling],
  );

  useEffect(() => {
    fetchLiveStatus()
      .then((s) => {
        setStatus(s);
        if (s.myRunId) {
          refresh(s.myRunId).catch(() => undefined);
          startPolling(s.myRunId);
        }
      })
      .catch(() =>
        setStatus({
          enabled: false,
          signedIn: false,
          displayName: null,
          myRunId: null,
        }),
      );
    fetchPlatformStatus()
      .then(setPlatform)
      .catch(() => setPlatform(null));
  }, [refresh, startPolling]);

  const provision = useCallback(async () => {
    setBusy("provision");
    setError(null);
    try {
      const created = await createLiveRun(SANDBOX);
      setRun(created);
      startPolling(created.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not provision.");
    } finally {
      setBusy(null);
    }
  }, [startPolling]);

  const act = useCallback(
    async (
      key: string,
      fn: () => Promise<LiveRunView | void>,
      optimistic?: (r: LiveRunView) => LiveRunView,
    ) => {
      setBusy(key);
      setError(null);
      mutationSeq.current += 1;
      // Reflect the intent immediately so the control does not sit on its old value while the
      // broker patches the LabRun.
      if (optimistic) setRun((r) => (r ? optimistic(r) : r));
      try {
        const next = await fn();
        mutationSeq.current += 1;
        if (next) setRun(next as LiveRunView);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action rejected.");
        mutationSeq.current += 1;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

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
      setReport(null);
      setSelected(null);
      fetchPlatformStatus()
        .then(setPlatform)
        .catch(() => setPlatform(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Teardown failed.");
    } finally {
      setBusy(null);
    }
  }, [run, stopPolling]);

  const byName = useCallback(
    (n: string) => components.find((c) => c.name === n),
    [components],
  );

  // The React Compiler memoizes this; a manual useMemo here would only fight it.
  const drill = run?.drillId
    ? (drills.find((d) => d.id === run.drillId) ?? null)
    : null;

  // ── empty / signed-out ────────────────────────────────────────────────────
  if (!run) {
    const signedIn = status?.signedIn === true;
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

          {signedIn ? (
            <button
              className={styles.primary}
              onClick={provision}
              disabled={
                status?.enabled !== true || busy !== null || slots === 0
              }
            >
              <Play size={16} fill="currentColor" />
              {busy === "provision"
                ? "Provisioning…"
                : status?.enabled === false
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

  // ── live cluster: canvas + inspector ──────────────────────────────────────
  const t = run.telemetry;
  const provisioning = run.status === "provisioning";
  const totalCpu = components.reduce((a, c) => a + c.cpuMillicores, 0);
  const totalMem = components.reduce((a, c) => a + c.memoryMiB, 0);
  const flowing = run.loadEnabled && t.requestsPerSec > 0;
  const selectedComp = selected ? byName(selected) : null;
  const selectedNode = NODES.find((n) => n.id === selected);

  return (
    <div className={styles.shell}>
      {/* top bar */}
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <span
            className={`${styles.dot} ${provisioning ? styles.dotWarn : styles.dotOk}`}
          />
          <b>Practice cluster</b>
          <code>{run.namespace ?? run.runId}</code>
          {drill && <span className={styles.drillTag}>{run.drillTitle}</span>}
        </div>
        <div className={styles.topStats}>
          <span title="Requests per second through Envoy">
            <Activity size={13} /> {t.requestsPerSec}/s
          </span>
          <span
            className={
              t.p95LatencyMs > t.latencyTargetMs ? styles.warnText : ""
            }
            title="p95 latency"
          >
            <Gauge size={13} /> {t.p95LatencyMs}ms
          </span>
          <span
            className={t.errorRatePct > 1 ? styles.warnText : ""}
            title="5xx error rate"
          >
            <AlertTriangle size={13} /> {t.errorRatePct.toFixed(2)}%
          </span>
          <span title="Cluster CPU / memory in use">
            <Cpu size={13} /> {totalCpu}m
          </span>
          <span>
            <MemoryStick size={13} /> {totalMem}Mi
          </span>
          <span title="Time until automatic teardown">
            <Timer size={13} /> {clock(run.remainingTtlMs)}
          </span>
          <button
            className={styles.danger}
            onClick={teardown}
            disabled={busy !== null}
          >
            <Trash2 size={13} /> Tear down
          </button>
        </div>
      </header>

      {error && (
        <p className={styles.errorFloat} role="alert">
          {error}
        </p>
      )}

      <div className={styles.body}>
        {/* ── canvas ── */}
        <div className={styles.canvas} ref={canvasRef}>
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
              const healthy = desired > 0 && ready === desired;
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
                          : healthy
                            ? styles.badgeOk
                            : styles.badgeWarn
                      }`}
                    >
                      {off ? "off" : `${ready}/${desired}`}
                    </span>
                  </span>

                  {c && c.pods.length > 0 && (
                    <span className={styles.nodePods}>
                      {c.pods.map((p) => {
                        const pct =
                          limit > 0
                            ? Math.min(100, (p.cpuMillicores / limit) * 100)
                            : 0;
                        return (
                          <span key={p.name} className={styles.podRow}>
                            <span className={styles.podBar}>
                              <i
                                className={pct > 85 ? styles.podHot : ""}
                                style={{ width: `${Math.max(4, pct)}%` }}
                              />
                            </span>
                            <span className={styles.podNum}>
                              {p.cpuMillicores}m
                            </span>
                          </span>
                        );
                      })}
                    </span>
                  )}

                  <span className={styles.nodeFoot}>
                    {off ? (
                      "not provisioned"
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

          <div className={styles.canvasFoot}>
            <span className={flowing ? styles.liveChip : styles.idleChip}>
              <i /> {flowing ? "traffic flowing" : "traffic stopped"}
            </span>
            <span>
              {run.podCount ?? 0} pods · {components.length} services
            </span>
            <span>SLO score {t.score}</span>
            {trace && trace.spans.length > 0 && (
              <span>
                trace {trace.durationMs}ms · {trace.release}
              </span>
            )}
          </div>
        </div>

        {/* ── inspector ── */}
        <aside className={styles.inspector}>
          {selectedComp || selectedNode ? (
            <div className={styles.panel}>
              <button
                className={styles.backBtn}
                onClick={() => setSelected(null)}
              >
                <ChevronLeft size={14} /> Drills, controls &amp; activity
              </button>
              <div className={styles.panelHead}>
                <b>{selectedNode?.label}</b>
                <button
                  className={styles.iconBtn}
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <p className={styles.panelSub}>{selectedNode?.role}</p>

              {selectedComp ? (
                <>
                  <div className={styles.kv}>
                    <span>Replicas</span>
                    <b>
                      {selectedComp.ready}/{selectedComp.desired}
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>CPU</span>
                    <b>
                      {selectedComp.cpuMillicores}m of{" "}
                      {selectedComp.cpuLimitMillicoresPerPod *
                        Math.max(1, selectedComp.desired)}
                      m
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>Memory</span>
                    <b>{selectedComp.memoryMiB} MiB</b>
                  </div>
                  <div className={styles.kv}>
                    <span>CPU per replica</span>
                    <b>
                      {selectedComp.pods.length > 0
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
                      {selectedComp.cpuLimitMillicoresPerPod > 0 &&
                      selectedComp.pods.length > 0
                        ? Math.round(
                            (selectedComp.cpuMillicores /
                              (selectedComp.cpuLimitMillicoresPerPod *
                                selectedComp.pods.length)) *
                              100,
                          )
                        : 0}
                      % of limit
                    </b>
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
                    {selectedComp.pods.length === 0 && (
                      <p className={styles.blank}>No pods scheduled.</p>
                    )}
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
                <button
                  className={tab === "drills" ? styles.tabOn : ""}
                  onClick={() => setTab("drills")}
                >
                  <Gauge size={13} /> Drills
                </button>
                <button
                  className={tab === "controls" ? styles.tabOn : ""}
                  onClick={() => setTab("controls")}
                >
                  <SlidersHorizontal size={13} /> Controls
                </button>
                <button
                  className={tab === "activity" ? styles.tabOn : ""}
                  onClick={() => setTab("activity")}
                >
                  <Layers size={13} /> Activity
                </button>
              </div>

              {tab === "drills" &&
                (!drill ? (
                  <>
                    <p className={styles.hint}>
                      A drill sets an objective and a clock on this cluster and
                      unlocks its operator decisions. Nothing is reprovisioned.
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
                            {String(i + 1).padStart(2, "0")}
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
                ) : (
                  <>
                    <div className={styles.objective}>
                      <b>{run.drillTitle || drill.title}</b>
                      <p>{run.drillObjective || drill.summary}</p>
                      <span>
                        {clock(run.elapsedMs)} / {clock(run.durationMs)}
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
                        return (
                          <div key={o.id} className={styles.qWrap}>
                            <button
                              className={`${styles.decision} ${
                                answered
                                  ? right
                                    ? styles.qRight
                                    : styles.qWrong
                                  : ""
                              }`}
                              onClick={() =>
                                act(`dec-${o.id}`, () =>
                                  liveDecision(run.runId, o.id),
                                )
                              }
                              disabled={
                                !o.unlocked || answered || busy !== null
                              }
                            >
                              {answered ? (
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
                                <small>{o.description}</small>
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
                    {report && (
                      <div className={styles.report}>
                        <b>
                          {report.outcome} · {report.score}
                        </b>
                        <p>{report.summary}</p>
                      </div>
                    )}
                    <button
                      className={styles.ghost}
                      onClick={() => act("end", () => endDrill(run.runId))}
                      disabled={busy !== null}
                    >
                      <Square size={12} /> End drill, keep cluster
                    </button>
                  </>
                ))}

              {tab === "controls" && (
                <div className={styles.controls}>
                  {controlGroups.map((g) => {
                    const activeId = g.active(run);
                    return (
                      <div key={g.label} className={styles.control}>
                        <label>{g.label}</label>
                        <div className={styles.segments}>
                          {g.options.map((o) => (
                            <button
                              key={o.id}
                              className={`${activeId === o.id ? styles.segOn : ""} ${busy === o.id ? styles.segBusy : ""}`}
                              onClick={() =>
                                act(
                                  o.id,
                                  () => practiceAction(run.runId, o.id),
                                  o.apply,
                                )
                              }
                              disabled={busy !== null || activeId === o.id}
                            >
                              {o.label}
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
