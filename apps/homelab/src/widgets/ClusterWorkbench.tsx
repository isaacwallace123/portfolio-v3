"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
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
  RefreshCw,
  Server,
  Square,
  Timer,
  Trash2,
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

// Each tier of the request path, in flow order, mapped to the Deployment that backs it.
const TIERS = [
  { id: "k6", label: "k6", role: "load generator", icon: Zap, accent: "load" },
  { id: "envoy", label: "Envoy", role: "gateway", icon: Radio, accent: "edge" },
  {
    id: "checkout",
    label: "checkout",
    role: "API",
    icon: Server,
    accent: "app",
  },
] as const;

const DATA_TIERS = [
  { id: "postgres", label: "Postgres", role: "database", icon: Database },
  { id: "redis", label: "Redis", role: "cache", icon: Database },
] as const;

const controlGroups = [
  {
    label: "Checkout replicas",
    hint: "Each replica adds CPU, so capacity scales and p95 falls under load.",
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
    hint: "Redis in front of Postgres. Cache hits skip the request's work entirely.",
    options: [
      { id: "cache-off", label: "Off" },
      { id: "cache-on", label: "On" },
    ],
    active: (r: LiveRunView) =>
      r.telemetry.cacheActive ? "cache-on" : "cache-off",
  },
  {
    label: "Release track",
    hint: "The candidate build has a real slow, occasionally failing pricing path.",
    options: [
      { id: "release-stable", label: "Stable" },
      { id: "release-candidate", label: "Candidate" },
    ],
    active: (r: LiveRunView) => `release-${r.releaseTrack}`,
  },
  {
    label: "Traffic",
    hint: "The k6 load generator driving real requests through the gateway.",
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
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** A tier node in the flowchart: live readiness, aggregate usage, and every pod behind it. */
function TierNode({
  label,
  role,
  Icon,
  component,
  accent,
  detail,
  dimmed,
}: {
  label: string;
  role: string;
  Icon: typeof Server;
  component?: RunComponent;
  accent?: string;
  detail?: string;
  dimmed?: boolean;
}) {
  const desired = component?.desired ?? 0;
  const ready = component?.ready ?? 0;
  const healthy = desired > 0 && ready === desired;
  const pods = component?.pods ?? [];
  const limit = component?.cpuLimitMillicoresPerPod ?? 0;

  return (
    <div
      className={`${styles.tier} ${dimmed ? styles.tierDim : ""} ${
        accent ? (styles[`tier-${accent}`] ?? "") : ""
      }`}
    >
      <div className={styles.tierTop}>
        <span className={styles.tierIcon}>
          <Icon size={15} />
        </span>
        <div className={styles.tierName}>
          <b>{label}</b>
          <small>{role}</small>
        </div>
        <span
          className={`${styles.pill} ${
            desired === 0
              ? styles.pillIdle
              : healthy
                ? styles.pillOk
                : styles.pillWarn
          }`}
        >
          {desired === 0 ? "off" : `${ready}/${desired}`}
        </span>
      </div>

      {detail && <p className={styles.tierDetail}>{detail}</p>}

      {pods.length > 0 && (
        <div className={styles.pods}>
          {pods.map((p) => {
            const pct =
              limit > 0 ? Math.min(100, (p.cpuMillicores / limit) * 100) : 0;
            return (
              <div key={p.name} className={styles.pod} title={`pod …${p.name}`}>
                <span className={styles.podId}>…{p.name}</span>
                <div className={styles.podBar}>
                  <i
                    className={pct > 85 ? styles.podBarHot : ""}
                    style={{ width: `${Math.max(3, pct)}%` }}
                  />
                </div>
                <span className={styles.podStat}>{p.cpuMillicores}m</span>
                <span className={styles.podStat}>{p.memoryMiB}Mi</span>
                {!p.ready && <span className={styles.podWarn}>starting</span>}
                {p.restarts > 0 && (
                  <span className={styles.podWarn}>×{p.restarts}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {component && pods.length > 0 && (
        <div className={styles.tierTotals}>
          <span>
            <Cpu size={11} /> {component.cpuMillicores}m
          </span>
          <span>
            <MemoryStick size={11} /> {component.memoryMiB} MiB
          </span>
        </div>
      )}
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
  const poll = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (poll.current !== null) {
      window.clearInterval(poll.current);
      poll.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const refresh = useCallback(async (runId: string) => {
    const [view, comps, evts, tr] = await Promise.all([
      getLiveRun(runId),
      fetchComponents(runId).catch(() => [] as RunComponent[]),
      fetchRunEvents(runId).catch(() => [] as ClusterEvent[]),
      getLiveTrace(runId).catch(() => null),
    ]);
    setRun(view);
    setComponents(comps);
    setEvents(evts);
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

  // Resume the cluster this account already owns, so a reload never orphans one.
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
      setComponents([]);
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

  const byName = (n: string) => components.find((c) => c.name === n);

  // ── signed out / no cluster ────────────────────────────────────────────────
  if (!run) {
    const signedIn = status?.signedIn === true;
    const slots = platform?.slotsAvailable ?? null;
    const signInUrl = `${AUTH_URL}/login?returnUrl=${encodeURIComponent(
      `${HOMELAB_URL}/practice`,
    )}`;

    return (
      <div className={styles.page}>
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
              <Server size={15} /> Isolated namespace with a quota and a
              default-deny network policy
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
            <>
              <a className={styles.primary} href={signInUrl}>
                <Lock size={16} /> Sign in to provision
              </a>
              <p className={styles.capacity}>
                Provisioning creates real infrastructure, so it is tied to an
                account. Signing in takes a second and needs no password.
              </p>
            </>
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

  // ── live cluster ───────────────────────────────────────────────────────────
  const t = run.telemetry;
  const drill = run.drillId ? drills.find((d) => d.id === run.drillId) : null;
  const overSlo = t.p95LatencyMs > t.latencyTargetMs;
  const erroring = t.errorRatePct > 1;
  const provisioning = run.status === "provisioning";
  const totalCpu = components.reduce((a, c) => a + c.cpuMillicores, 0);
  const totalMem = components.reduce((a, c) => a + c.memoryMiB, 0);

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.barMain}>
          <span
            className={`${styles.dot} ${provisioning ? styles.dotWarn : styles.dotOk}`}
          />
          <h1>Practice cluster</h1>
          <code className={styles.ns}>{run.namespace ?? run.runId}</code>
          {drill && <span className={styles.drillTag}>{run.drillTitle}</span>}
        </div>
        <div className={styles.barMeta}>
          <span>
            <Cpu size={13} /> {totalCpu}m
          </span>
          <span>
            <MemoryStick size={13} /> {totalMem} MiB
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

      <section className={styles.canvas}>
        <div className={styles.canvasHead}>
          <h2>
            <Activity size={15} /> Request path
          </h2>
          <span className={styles.sub}>
            {run.loadEnabled ? "traffic flowing" : "traffic stopped"} · measured
            at the gateway
          </span>
        </div>

        <div className={styles.flow}>
          {TIERS.map((tier) => (
            <div key={tier.id} className={styles.flowStep}>
              <TierNode
                label={tier.label}
                role={tier.role}
                Icon={tier.icon}
                accent={tier.accent}
                component={byName(tier.id)}
                dimmed={tier.id === "k6" && !run.loadEnabled}
                detail={
                  tier.id === "envoy"
                    ? `${t.requestsPerSec} req/s · p95 ${t.p95LatencyMs}ms`
                    : tier.id === "checkout"
                      ? `release ${run.releaseTrack} · pool ${run.targetPool}`
                      : run.loadEnabled
                        ? "closed-loop load"
                        : "stopped"
                }
              />
              <div
                className={`${styles.link} ${run.loadEnabled ? styles.linkLive : ""}`}
              >
                <ArrowRight size={14} />
              </div>
            </div>
          ))}

          <div className={styles.dataCol}>
            {DATA_TIERS.map((d) => (
              <TierNode
                key={d.id}
                label={d.label}
                role={d.role}
                Icon={d.icon}
                component={byName(d.id)}
                dimmed={d.id === "redis" && !t.cacheActive}
                detail={
                  d.id === "postgres"
                    ? `${t.postgresCpuPct}% of its CPU limit`
                    : t.cacheActive
                      ? "serving reads"
                      : "not provisioned"
                }
              />
            ))}
          </div>
        </div>

        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span>Throughput</span>
            <strong>
              {t.requestsPerSec}
              <i>/s</i>
            </strong>
            <small>requests through Envoy</small>
          </div>
          <div
            className={`${styles.metric} ${overSlo ? styles.bad : styles.good}`}
          >
            <span>p95 latency</span>
            <strong>
              {t.p95LatencyMs}
              <i>ms</i>
            </strong>
            <small>objective &lt; {t.latencyTargetMs}ms</small>
          </div>
          <div
            className={`${styles.metric} ${erroring ? styles.bad : styles.good}`}
          >
            <span>Error rate</span>
            <strong>
              {t.errorRatePct.toFixed(2)}
              <i>%</i>
            </strong>
            <small>5xx responses</small>
          </div>
          <div className={styles.metric}>
            <span>Pods</span>
            <strong>{run.podCount ?? 0}</strong>
            <small>{components.length} components</small>
          </div>
          <div className={styles.metric}>
            <span>SLO score</span>
            <strong>{t.score}</strong>
            <small>latency + errors</small>
          </div>
        </div>
      </section>

      <div className={styles.grid}>
        <div className={styles.main}>
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
                  unlocks its operator decisions. The workload stays up —
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
                <RefreshCw size={15} /> Cluster controls
              </h2>
              <span className={styles.sub}>reconciled live</span>
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
              <Lock size={13} /> This cluster is private to your account and
              cannot be reached by anyone else.
            </p>
            <p>
              <CircleSlash size={13} /> Egress is denied by default; the
              namespace is quota-capped and torn down automatically.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
