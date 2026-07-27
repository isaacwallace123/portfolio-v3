"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  ChevronRight,
  CircleSlash,
  Cpu,
  Database,
  Gauge,
  Layers,
  MemoryStick,
  Play,
  Radio,
  Server,
  Square,
  Timer,
  Trash2,
  Zap,
} from "lucide-react";
import { homelabScenarios } from "@/entities/scenario";
import {
  createLiveRun,
  endDrill,
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
  type LiveTrace,
} from "@/shared/lib/liveClient";
import styles from "./ClusterWorkbench.module.css";

const SANDBOX = "practice-cluster";

// The drill catalog is every scenario except the open sandbox itself.
const drills = homelabScenarios.filter((s) => s.id !== SANDBOX);

// Allowlisted cluster controls. Each maps to one broker-side reconciliation of the live workload.
const controlGroups = [
  {
    label: "Checkout replicas",
    hint: "Capacity. Each replica adds CPU, so more replicas lower p95 under load.",
    options: [
      { id: "scale-1", label: "1" },
      { id: "scale-3", label: "3" },
      { id: "scale-6", label: "6" },
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
    hint: "Redis in front of Postgres. Serving from cache skips the request's CPU work entirely.",
    options: [
      { id: "cache-off", label: "Off" },
      { id: "cache-on", label: "On" },
    ],
    active: (r: LiveRunView) =>
      r.telemetry.cacheActive ? "cache-on" : "cache-off",
  },
  {
    label: "Release track",
    hint: "The candidate build contains a real slow, occasionally failing pricing path.",
    options: [
      { id: "release-stable", label: "Stable" },
      { id: "release-candidate", label: "Candidate" },
    ],
    active: (r: LiveRunView) => `release-${r.releaseTrack}`,
  },
  {
    label: "Traffic",
    hint: "The k6 load generator driving real requests through Envoy.",
    options: [
      { id: "traffic-off", label: "Off" },
      { id: "traffic-on", label: "On" },
    ],
    active: (r: LiveRunView) => (r.loadEnabled ? "traffic-on" : "traffic-off"),
  },
  {
    label: "Worker pool",
    hint: "Which node pool the checkout replicas are scheduled onto.",
    options: [
      { id: "move-apps", label: "Apps" },
      { id: "move-infra", label: "Infra" },
    ],
    active: (r: LiveRunView) => `move-${r.targetPool}`,
  },
] as const;

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function ClusterWorkbench() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [report, setReport] = useState<LiveReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    fetchLiveStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
    fetchPlatformStatus()
      .then(setPlatform)
      .catch(() => setPlatform(null));
  }, []);

  const stopPolling = useCallback(() => {
    if (poll.current !== null) {
      window.clearInterval(poll.current);
      poll.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const refresh = useCallback(async (runId: string) => {
    const [view, evts, tr] = await Promise.all([
      getLiveRun(runId),
      fetchRunEvents(runId).catch(() => [] as ClusterEvent[]),
      getLiveTrace(runId).catch(() => null),
    ]);
    setRun(view);
    setEvents(evts);
    if (tr) setTrace(tr);
    if (view.drillComplete)
      setReport(await getLiveReport(runId).catch(() => null));
    else setReport(null);
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
    async (key: string, fn: () => Promise<LiveRunView | void>) => {
      setBusy(key);
      setError(null);
      try {
        const next = await fn();
        if (next) setRun(next as LiveRunView);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action rejected.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const teardown = useCallback(async () => {
    if (!run) return;
    setBusy("teardown");
    setError(null);
    try {
      await teardownLiveRun(run.runId);
      stopPolling();
      setRun(null);
      setEvents([]);
      setTrace(null);
      setReport(null);
      fetchPlatformStatus()
        .then(setPlatform)
        .catch(() => setPlatform(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Teardown failed.");
    } finally {
      setBusy(null);
    }
  }, [run, stopPolling]);

  // ── empty state ────────────────────────────────────────────────────────────
  if (!run) {
    const slots = platform?.slotsAvailable ?? null;
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <p className={styles.kicker}>
            <Radio size={14} /> Real cluster control
          </p>
          <h1>Build a cluster. Then break it.</h1>
          <p className={styles.lede}>
            Provision a disposable Kubernetes workspace on the live homelab — an
            isolated namespace with a checkout API, Postgres, Redis, an Envoy
            gateway and a k6 load generator. Operate it freely, or run a drill
            on it and work a real incident.
          </p>

          <ul className={styles.included}>
            <li>
              <Server size={15} /> Isolated namespace, quota &amp; default-deny
              network policy
            </li>
            <li>
              <Layers size={15} /> checkout · postgres · redis · envoy · k6
            </li>
            <li>
              <Activity size={15} /> Metrics measured by the run&apos;s own
              Envoy gateway
            </li>
            <li>
              <Timer size={15} /> Self-destructs after 15 minutes
            </li>
          </ul>

          <button
            className={styles.primary}
            onClick={provision}
            disabled={enabled !== true || busy !== null || slots === 0}
          >
            <Play size={16} fill="currentColor" />
            {busy === "provision"
              ? "Provisioning…"
              : enabled === false
                ? "Live control offline"
                : slots === 0
                  ? "All cluster slots busy"
                  : "Provision cluster"}
          </button>
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

  // ── live cluster ───────────────────────────────────────────────────────────
  const t = run.telemetry;
  const drill = run.drillId ? drills.find((d) => d.id === run.drillId) : null;
  const overSlo = t.p95LatencyMs > t.latencyTargetMs;
  const erroring = t.errorRatePct > 1;
  const provisioning = run.status === "provisioning";

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.barMain}>
          <span
            className={`${styles.dot} ${provisioning ? styles.dotWarn : styles.dotOk}`}
          />
          <h1>Practice cluster</h1>
          <code className={styles.ns}>{run.namespace ?? run.runId}</code>
        </div>
        <div className={styles.barMeta}>
          <span>
            <Boxes size={13} /> {run.podCount ?? "—"} pods
          </span>
          <span>
            <Timer size={13} /> {clock(run.remainingTtlMs)} left
          </span>
          <button
            className={styles.danger}
            onClick={teardown}
            disabled={busy !== null}
          >
            <Trash2 size={14} /> Tear down
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.grid}>
        {/* main column */}
        <div className={styles.main}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>
                <Activity size={15} /> Request path
              </h2>
              <span className={styles.sub}>measured at the gateway</span>
            </div>

            <div className={styles.path}>
              <div
                className={`${styles.node} ${run.loadEnabled ? "" : styles.nodeIdle}`}
              >
                <Zap size={15} />
                <b>k6</b>
                <small>{run.loadEnabled ? "driving load" : "stopped"}</small>
              </div>
              <ChevronRight size={16} className={styles.arrow} />
              <div className={styles.node}>
                <Radio size={15} />
                <b>Envoy</b>
                <small>{t.requestsPerSec}/s</small>
              </div>
              <ChevronRight size={16} className={styles.arrow} />
              <div
                className={`${styles.node} ${overSlo ? styles.nodeHot : ""}`}
              >
                <Server size={15} />
                <b>checkout</b>
                <small>{t.apiReplicas} replicas</small>
              </div>
              <ChevronRight size={16} className={styles.arrow} />
              <div className={styles.stack}>
                <div className={styles.node}>
                  <Database size={14} />
                  <b>postgres</b>
                  <small>{t.postgresCpuPct}% cpu</small>
                </div>
                <div
                  className={`${styles.node} ${t.cacheActive ? styles.nodeGood : styles.nodeIdle}`}
                >
                  <Database size={14} />
                  <b>redis</b>
                  <small>{t.cacheActive ? "serving" : "off"}</small>
                </div>
              </div>
            </div>

            <div className={styles.metrics}>
              <div className={styles.metric}>
                <span>Throughput</span>
                <strong>
                  {t.requestsPerSec}
                  <i>/s</i>
                </strong>
              </div>
              <div
                className={`${styles.metric} ${overSlo ? styles.bad : styles.good}`}
              >
                <span>p95 latency</span>
                <strong>
                  {t.p95LatencyMs}
                  <i>ms</i>
                </strong>
                <small>target &lt; {t.latencyTargetMs}ms</small>
              </div>
              <div
                className={`${styles.metric} ${erroring ? styles.bad : styles.good}`}
              >
                <span>Errors</span>
                <strong>
                  {t.errorRatePct.toFixed(2)}
                  <i>%</i>
                </strong>
              </div>
              <div className={styles.metric}>
                <span>Resources</span>
                <strong>
                  {run.cpuMillicores ?? 0}
                  <i>m</i>
                </strong>
                <small>{run.memoryMiB ?? 0} MiB</small>
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>
                <Layers size={15} /> Cluster activity
              </h2>
              <span className={styles.sub}>live Kubernetes events</span>
            </div>
            <div className={styles.events}>
              {events.length === 0 ? (
                <p className={styles.blank}>
                  {provisioning ? "Scheduling workloads…" : "No recent events."}
                </p>
              ) : (
                events
                  .slice()
                  .reverse()
                  .map((e) => (
                    <article key={e.id} className={styles.event}>
                      <i
                        className={
                          e.severity === "warning" ? styles.evWarn : styles.evOk
                        }
                      />
                      <div>
                        <p>
                          <b>{e.reason}</b>
                          <span className={styles.evMeta}>
                            {e.objectKind} · {ago(e.at)} ago
                          </span>
                        </p>
                        <small>{e.message}</small>
                      </div>
                    </article>
                  ))
              )}
            </div>
          </section>

          {trace && trace.spans.length > 0 && (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>
                  <Gauge size={15} /> Request trace
                </h2>
                <span className={styles.sub}>
                  {trace.durationMs}ms · {trace.release}
                </span>
              </div>
              <div className={styles.trace}>
                {trace.spans.map((s) => (
                  <div key={s.spanId} className={styles.span}>
                    <span className={styles.spanName}>{s.name}</span>
                    <div className={styles.spanBar}>
                      <i
                        className={s.status === "error" ? styles.spanErr : ""}
                        style={{
                          width: `${Math.max(2, Math.min(100, (s.durationMs / Math.max(1, trace.durationMs)) * 100))}%`,
                        }}
                      />
                    </div>
                    <b>{Math.round(s.durationMs)}ms</b>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* side column */}
        <div className={styles.side}>
          <section className={`${styles.card} ${styles.drillCard}`}>
            <div className={styles.cardHead}>
              <h2>
                <Gauge size={15} /> {drill ? "Active drill" : "Run a drill"}
              </h2>
              {drill && (
                <span className={styles.sub}>
                  {clock(run.elapsedMs)} / {clock(run.durationMs)}
                </span>
              )}
            </div>

            {!drill ? (
              <>
                <p className={styles.hint}>
                  A drill sets an objective and a clock on this cluster, then
                  unlocks the operator decisions for it. The workload stays up —
                  nothing is reprovisioned.
                </p>
                <div className={styles.drills}>
                  {drills.map((d, i) => (
                    <button
                      key={d.id}
                      className={styles.drillItem}
                      onClick={() =>
                        act(`drill-${d.id}`, () => startDrill(run.runId, d.id))
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
                      <ChevronRight size={15} />
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
                </div>
                <div className={styles.progress}>
                  <i
                    style={{
                      width: `${Math.min(100, (run.elapsedMs / Math.max(1, run.durationMs)) * 100)}%`,
                    }}
                  />
                </div>

                <div className={styles.decisions}>
                  {drill.decisions.map((d) => {
                    const done = run.acceptedDecisions.some(
                      (a) => a.id === d.id,
                    );
                    const open = run.availableDecisions.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        className={`${styles.decision} ${done ? styles.decisionDone : ""}`}
                        onClick={() =>
                          act(`dec-${d.id}`, () =>
                            liveDecision(run.runId, d.id),
                          )
                        }
                        disabled={!open || done || busy !== null}
                      >
                        {done ? <Check size={15} /> : <Gauge size={15} />}
                        <span>
                          <b>{d.label}</b>
                          <small>{d.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {report && (
                  <div className={styles.report}>
                    <b>
                      {report.outcome === "passed" ? (
                        <Check size={15} />
                      ) : (
                        <AlertTriangle size={15} />
                      )}
                      {report.outcome} · {report.score}
                    </b>
                    <p>{report.summary}</p>
                  </div>
                )}

                <button
                  className={styles.ghost}
                  onClick={() => act("end-drill", () => endDrill(run.runId))}
                  disabled={busy !== null}
                >
                  <Square size={13} /> End drill, keep cluster
                </button>
              </>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>
                <Cpu size={15} /> Cluster controls
              </h2>
              <span className={styles.sub}>applied to the live workload</span>
            </div>
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
                          className={activeId === o.id ? styles.segOn : ""}
                          onClick={() =>
                            act(o.id, () => practiceAction(run.runId, o.id))
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
            </div>
          </section>

          <section className={`${styles.card} ${styles.notes}`}>
            <p>
              <CircleSlash size={13} /> Egress is denied by default; the
              namespace is quota-capped and torn down automatically.
            </p>
            <p>
              <MemoryStick size={13} /> Every number on this page is measured
              from the running workload.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
