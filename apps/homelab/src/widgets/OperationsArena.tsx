"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Box,
  Check,
  CircleGauge,
  CloudCog,
  Database,
  Gauge,
  GitBranch,
  Play,
  RefreshCw,
  RotateCcw,
  Sliders,
  TimerReset,
  Trash2,
  Waves,
  Zap,
} from "lucide-react";
import {
  formatRunClock,
  isTerminalPhase,
  type EventSeverity,
  type RunTelemetry,
} from "@iw/lab-runtime";
import {
  getHomelabScenario,
  trafficSpikeScenario,
  upcomingDrills,
} from "@/entities/scenario";
import {
  createLiveRun,
  fetchPlatformStatus,
  fetchLiveStatus,
  getLiveRun,
  getLiveReport,
  getLiveTrace,
  liveDecision,
  practiceAction,
  teardownLiveRun,
  type LivePlatformStatus,
  type LiveReport,
  type LiveRunView,
  type LiveTrace,
} from "@/shared/lib/liveClient";

const severityClass: Record<EventSeverity, string> = {
  info: "event-info",
  success: "event-success",
  warning: "event-warning",
  critical: "event-critical",
};

const sandboxActionGroups = [
  {
    label: "API Replicas",
    actions: [
      ["scale-1", "1 replica"],
      ["scale-3", "3 replicas"],
      ["scale-6", "6 replicas"],
    ],
  },
  {
    label: "Release Track",
    actions: [
      ["release-stable", "Stable v1.4"],
      ["release-candidate", "Candidate (Regression)"],
    ],
  },
  {
    label: "Traffic Load",
    actions: [
      ["traffic-on", "Start k6 Load"],
      ["traffic-off", "Stop k6 Load"],
    ],
  },
  {
    label: "Cache Tier",
    actions: [
      ["cache-on", "Enable Redis"],
      ["cache-off", "Disable Redis"],
    ],
  },
  {
    label: "Placement",
    actions: [
      ["move-apps", "Apps Worker"],
      ["move-infra", "Infra Worker"],
    ],
  },
] as const;

function baselineTelemetry(): RunTelemetry {
  return {
    requestsPerSec: 0,
    p95LatencyMs: 0,
    latencyTargetMs: 120,
    errorRatePct: 0,
    apiReplicas: 0,
    postgresCpuPct: 0,
    cacheActive: false,
    score: 100,
  };
}

function Metric({
  label,
  value,
  detail,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "normal" | "warn" | "good";
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`status-chip status-${status}`}>
      <i /> {status}
    </span>
  );
}

export default function OperationsArena({ defaultScenarioId }: { defaultScenarioId?: string }) {
  const [scenarioId, setScenarioId] = useState(defaultScenarioId ?? trafficSpikeScenario.id);
  const scenario = getHomelabScenario(scenarioId);
  const [liveEnabled, setLiveEnabled] = useState<boolean | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [report, setReport] = useState<LiveReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeConsoleTab, setActiveConsoleTab] = useState<"decisions" | "sandbox">("decisions");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetchLiveStatus()
      .then((s) => setLiveEnabled(s.enabled))
      .catch(() => setLiveEnabled(false));
    fetchPlatformStatus()
      .then(setPlatform)
      .catch(() => setPlatform(null));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const [view, latestTrace] = await Promise.all([
            getLiveRun(runId),
            getLiveTrace(runId).catch(() => null),
          ]);
          setRun(view);
          if (latestTrace) setTrace(latestTrace);
          if (isTerminalPhase(view.status)) {
            stopPolling();
            setReport(await getLiveReport(runId).catch(() => null));
          }
        } catch {
          stopPolling();
        }
      }, 2000);
    },
    [stopPolling],
  );

  const startRun = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setTrace(null);
    setReport(null);
    try {
      const created = await createLiveRun(scenario.id);
      setRun(created);
      setScenarioId(created.scenarioId);
      startPolling(created.runId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not queue the drill.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, scenario.id, startPolling]);

  const intervene = useCallback(
    async (decisionId: string) => {
      if (!run) return;
      setError(null);
      try {
        setRun(await liveDecision(run.runId, decisionId));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Decision was not accepted.",
        );
      }
    },
    [run],
  );

  const executeSandboxAction = useCallback(
    async (actionId: string) => {
      if (!run) return;
      setActionBusy(actionId);
      setError(null);
      try {
        setRun(await practiceAction(run.runId, actionId));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Sandbox action rejected.",
        );
      } finally {
        setActionBusy(null);
      }
    },
    [run],
  );

  const teardown = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      await teardownLiveRun(run.runId);
      stopPolling();
      setRun(null);
      setTrace(null);
      setReport(null);
      fetchPlatformStatus()
        .then(setPlatform)
        .catch(() => setPlatform(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teardown failed.");
    } finally {
      setBusy(false);
    }
  }, [run, stopPolling]);

  const status = run?.status ?? "idle";
  const active = run !== null && !isTerminalPhase(run.status);
  const tel = run?.telemetry ?? baselineTelemetry();
  const elapsedMs = run?.elapsedMs ?? 0;
  const progress = run ? Math.min(1, elapsedMs / scenario.durationMs) : 0;
  const visibleEvents = run?.visibleEvents ?? [];
  const acceptedDecisions = run?.acceptedDecisions ?? [];
  const phaseLabel = run
    ? (visibleEvents.at(-1)?.phase ?? run.status)
    : "Standby";

  const pressure = tel.errorRatePct > 1;
  const cached = tel.cacheActive;
  const latency = tel.p95LatencyMs;
  const namespace = run?.namespace ?? "run-hl-idle";
  const pods = run?.podCount ?? null;

  const canStart = liveEnabled === true && !busy && run === null;
  const capacityFree = platform?.capacityFreePct ?? 0;
  const liveSpans = trace?.spans ?? [];

  const chooseScenario = useCallback(
    (id: string) => {
      if (run) return;
      setScenarioId(id);
      setError(null);
      document.getElementById("arena")?.scrollIntoView({ behavior: "smooth" });
    },
    [run],
  );

  return (
    <div className="site-frame">
      <main id="top">
        <section className="hero">
          <div className="hero-copy" data-lab-reveal>
            <p className="kicker">
              <Waves size={15} /> Interactive SRE & Platform Engineering Arena
            </p>
            <h1>
              Don&apos;t tour the infrastructure. <em>Operate it.</em>
            </h1>
            <p className="hero-lede">
              Queue a disposable production incident or launch an interactive practice cluster on the{" "}
              <strong>live homelab Kubernetes cluster</strong>. Read signals, execute operator decisions, and inspect real-time reconciliation.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={startRun}
                disabled={!canStart}
              >
                <Play size={17} fill="currentColor" />{" "}
                {busy
                  ? "Provisioning…"
                  : active
                    ? "Drill in progress"
                    : liveEnabled === false
                      ? "Live control offline"
                      : run
                        ? "Tear down to run again"
                        : `Queue ${scenario.title}`}
              </button>
              {run ? (
                <button
                  className="text-link"
                  onClick={teardown}
                  disabled={busy}
                >
                  <Trash2 size={15} /> Tear down workspace
                </button>
              ) : (
                <a className="text-link" href="#arena">
                  Explore the control room <ArrowRight size={15} />
                </a>
              )}
            </div>
            {error && (
              <p className="hero-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div
            className="hero-console"
            aria-label="Current platform status"
            data-lab-reveal
            data-lab-delay="120"
          >
            <div className="console-top">
              <span>PLATFORM / NOW</span>
              <span className="live-dot">
                {platform?.cluster === "ready"
                  ? "LIVE K3S CLUSTER"
                  : "CONTROL PLANE"}
              </span>
            </div>
            <div
              className="capacity-ring"
              style={{ "--value": `${capacityFree}%` } as React.CSSProperties}
            >
              <div>
                <strong>{capacityFree}%</strong>
                <span>run capacity free</span>
              </div>
            </div>
            <div className="console-grid">
              <span>
                <b>{platform?.nodesReady ?? "—"}</b> /{" "}
                {platform?.nodesTotal ?? "—"} nodes ready
              </span>
              <span>
                <b>{pods ?? "—"}</b> run pods
              </span>
              <span>
                <b>{platform?.cluster ?? "—"}</b> cluster state
              </span>
              <span>
                <b>{platform?.slotsAvailable ?? "—"}</b> drill slots
              </span>
            </div>
            <p>
              Public controls are allowlisted. Personal workloads remain isolated outside the drill boundary.
            </p>
          </div>
        </section>

        <section className="arena-section" id="arena">
          <div className="section-heading">
            <div>
              <p className="kicker">
                <Activity size={15} /> Operations theatre
              </p>
              <h2>{scenario.title}</h2>
            </div>
            <div className="run-meta">
              <StatusChip status={status} />
              <span>
                {formatRunClock(elapsedMs)} /{" "}
                {formatRunClock(scenario.durationMs)}
              </span>
              <span>{scenario.resourceClass} · 4 vCPU · 6 GiB</span>
            </div>
          </div>

          <div className="progress-track">
            <span style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="arena-grid">
            {/* Upgraded 2D Runtime Topology Canvas */}
            <section className="panel topology-panel">
              <div className="panel-title">
                <span>
                  <CloudCog size={16} /> Interactive Runtime Topology
                </span>
                <small>namespace / {namespace}</small>
              </div>

              <div className="runtime-topology-canvas">
                {/* SVG Flow Connections */}
                <svg className="runtime-flow-svg" aria-hidden="true">
                  <defs>
                    <linearGradient id="flowGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="var(--mint)" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="var(--acid)" stopOpacity="0.8" />
                    </linearGradient>
                  </defs>
                  {/* k6 -> Envoy */}
                  <path
                    d="M 110 65 L 190 65"
                    stroke="url(#flowGlow)"
                    strokeWidth={tel.requestsPerSec > 0 ? 3 : 1.5}
                    strokeDasharray={tel.requestsPerSec > 0 ? "6,4" : undefined}
                    className={tel.requestsPerSec > 0 ? "animated-traffic-line" : ""}
                  />
                  {/* Envoy -> Checkout API */}
                  <path
                    d="M 290 65 L 370 65"
                    stroke={pressure ? "var(--red)" : "url(#flowGlow)"}
                    strokeWidth={tel.requestsPerSec > 0 ? 3 : 1.5}
                    strokeDasharray={tel.requestsPerSec > 0 ? "6,4" : undefined}
                    className={tel.requestsPerSec > 0 ? "animated-traffic-line" : ""}
                  />
                  {/* Checkout API -> Postgres */}
                  <path
                    d="M 520 65 L 590 40"
                    stroke={tel.postgresCpuPct > 50 ? "var(--amber)" : "var(--mint)"}
                    strokeWidth={1.5}
                  />
                  {/* Checkout API -> Redis */}
                  <path
                    d="M 520 65 L 590 100"
                    stroke={cached ? "var(--acid)" : "rgba(141, 167, 154, 0.3)"}
                    strokeWidth={1.5}
                    strokeDasharray={cached ? "4,4" : undefined}
                  />
                </svg>

                <div className="runtime-node-grid">
                  {/* Node 1: k6 Load Generator */}
                  <div
                    className={`rt-node ${tel.requestsPerSec > 0 ? "node-active" : ""}`}
                  >
                    <div className="rt-node-icon">
                      <Zap size={18} />
                    </div>
                    <div className="rt-node-info">
                      <b>k6 edge</b>
                      <small>{tel.requestsPerSec} req/s</small>
                    </div>
                  </div>

                  {/* Flow Arrow */}
                  <ArrowRight className="rt-flow-arrow" />

                  {/* Node 2: Envoy Gateway */}
                  <div className="rt-node">
                    <div className="rt-node-icon">
                      <GitBranch size={18} />
                    </div>
                    <div className="rt-node-info">
                      <b>Envoy</b>
                      <small>gateway</small>
                    </div>
                  </div>

                  {/* Flow Arrow */}
                  <ArrowRight className="rt-flow-arrow" />

                  {/* Node 3: Checkout API Workload */}
                  <div className={`rt-node node-workload ${pressure ? "node-hot" : ""}`}>
                    <div className="rt-node-head">
                      <Box size={18} />
                      <div>
                        <b>Checkout API</b>
                        <small>{tel.apiReplicas} replicas</small>
                      </div>
                    </div>
                    <div className="rt-pod-grid">
                      {Array.from({ length: Math.max(1, tel.apiReplicas) }).map((_, idx) => (
                        <span key={idx} className={`rt-pod ${pressure ? "pod-pressure" : "pod-healthy"}`}>
                          <i /> pod-{idx + 1}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Flow Arrow */}
                  <ArrowRight className="rt-flow-arrow" />

                  {/* Node 4: Data Tier (Postgres & Redis) */}
                  <div className="rt-data-stack">
                    <div className={`rt-node ${tel.postgresCpuPct > 50 ? "node-warn" : ""}`}>
                      <Database size={16} />
                      <div>
                        <b>Postgres</b>
                        <small>{tel.postgresCpuPct > 0 ? `${tel.postgresCpuPct}% CPU` : "healthy"}</small>
                      </div>
                    </div>
                    <div className={`rt-node ${cached ? "node-good" : "node-idle"}`}>
                      <Database size={16} />
                      <div>
                        <b>Redis</b>
                        <small>{cached ? "cache active" : "standby"}</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Telemetry Bar */}
              <div className="metrics-row">
                <Metric
                  label="Requests"
                  value={`${tel.requestsPerSec}/s`}
                  detail="edge throughput"
                />
                <Metric
                  label="p95 latency"
                  value={`${latency} ms`}
                  detail={`target < ${tel.latencyTargetMs} ms`}
                  tone={latency > tel.latencyTargetMs ? "warn" : "good"}
                />
                <Metric
                  label="Error rate"
                  value={`${tel.errorRatePct.toFixed(2)}%`}
                  detail="5xx responses"
                  tone={tel.errorRatePct > 1 ? "warn" : "good"}
                />
                <Metric
                  label="Run score"
                  value={`${tel.score}`}
                  detail="SLO + decisions"
                  tone={tel.score > 85 ? "good" : "warn"}
                />
              </div>
            </section>

            {/* Combined Operator Console & Sandbox Controls */}
            <aside className="panel decision-panel">
              <div className="panel-title">
                <div className="console-tab-buttons">
                  <button
                    className={activeConsoleTab === "decisions" ? "active" : ""}
                    onClick={() => setActiveConsoleTab("decisions")}
                  >
                    <CircleGauge size={15} /> Incident Decisions
                  </button>
                  <button
                    className={activeConsoleTab === "sandbox" ? "active" : ""}
                    onClick={() => setActiveConsoleTab("sandbox")}
                  >
                    <Sliders size={15} /> Sandbox Controls
                  </button>
                </div>
                <small>{phaseLabel}</small>
              </div>

              {activeConsoleTab === "decisions" ? (
                <>
                  <p className="decision-intro">
                    Interventions modify the <strong>live Kubernetes workload</strong>—rollout updates, scale pods, or re-balance placement.
                  </p>
                  <div className="decision-list">
                    {scenario.decisions.map((decision) => {
                      const selected = acceptedDecisions.some(
                        (d) => d.id === decision.id,
                      );
                      const available =
                        run?.availableDecisions.includes(decision.id) ?? false;
                      return (
                        <button
                          key={decision.id}
                          onClick={() => intervene(decision.id)}
                          disabled={!available || selected}
                          className={selected ? "selected" : ""}
                        >
                          <span>
                            {selected ? <Check size={16} /> : <Gauge size={16} />}
                          </span>
                          <span>
                            <b>{decision.label}</b>
                            <small>{decision.description}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="sandbox-control-suite">
                  <p className="decision-intro">
                    Direct Crossplane reconciliation controls for testing custom failures and performance tuning.
                  </p>
                  <div className="sandbox-groups">
                    {sandboxActionGroups.map((group) => (
                      <fieldset key={group.label}>
                        <legend>{group.label}</legend>
                        <div className="sandbox-btn-row">
                          {group.actions.map(([id, label]) => (
                            <button
                              key={id}
                              onClick={() => executeSandboxAction(id)}
                              disabled={!active || actionBusy !== null}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                  <div className="sandbox-utility-row">
                    <button
                      onClick={() => executeSandboxAction("restart")}
                      disabled={!active || actionBusy !== null}
                    >
                      <RefreshCw size={14} /> Rollout Restart
                    </button>
                    <button
                      onClick={() => executeSandboxAction("reset")}
                      disabled={!active || actionBusy !== null}
                    >
                      <RotateCcw size={14} /> Reset Baseline
                    </button>
                  </div>
                </div>
              )}

              {status === "idle" && (
                <div className="console-empty">
                  <TimerReset size={22} />
                  <b>No active workspace</b>
                  <span>
                    {liveEnabled === false
                      ? "Live provisioning is currently offline."
                      : "Queue a scenario or click Launch Workspace to spin up an isolated namespace."}
                  </span>
                </div>
              )}
              {active && (
                <div className="evidence-ready">
                  <Check size={18} />
                  <span>
                    <b>Live on K3s cluster</b>
                    <small>
                      namespace {namespace}
                      {pods !== null ? ` · ${pods} pods` : ""}
                      {run?.cpuMillicores != null
                        ? ` · ${run.cpuMillicores}m CPU`
                        : ""}
                    </small>
                  </span>
                </div>
              )}
            </aside>

            {/* Event Stream */}
            <section className="panel timeline-panel">
              <div className="panel-title">
                <span>
                  <Activity size={16} /> Correlated Event Stream
                </span>
                <small>metrics · gitops · cluster</small>
              </div>
              <div className="event-stream">
                {visibleEvents.length === 0 &&
                acceptedDecisions.length === 0 ? (
                  <div className="timeline-empty">
                    Events will stream here when the run begins.
                  </div>
                ) : (
                  visibleEvents
                    .slice()
                    .reverse()
                    .map((event) => (
                      <article
                        key={event.id}
                        className={severityClass[event.severity]}
                      >
                        <time>{formatRunClock(event.offsetMs)}</time>
                        <i />
                        <div>
                          <span>{event.source}</span>
                          <b>{event.title}</b>
                          <p>{event.detail}</p>
                        </div>
                      </article>
                    ))
                )}
                {acceptedDecisions.map((decision) => (
                  <article key={decision.id} className="event-operator">
                    <time>{formatRunClock(decision.acceptedAtMs)}</time>
                    <i />
                    <div>
                      <span>operator</span>
                      <b>{decision.label}</b>
                      <p>Applied to the live workload.</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* Request Trace Waterfall */}
            <section className="panel trace-panel">
              <div className="panel-title">
                <span>
                  <GitBranch size={16} /> Request Trace
                </span>
                <small>
                  trace / {trace?.traceId.slice(0, 9) ?? "awaiting live spans"}
                </small>
              </div>
              <div className="trace-waterfall">
                {(liveSpans.length
                  ? liveSpans.map((span) => ({
                      name: span.name,
                      ms: span.durationMs,
                      w: Math.max(
                        8,
                        (span.durationMs /
                          Math.max(1, trace?.durationMs ?? 1)) *
                          90,
                      ),
                      error: span.status === "error",
                    }))
                  : [
                      { name: "envoy.gateway", ms: 4, w: 12, error: false },
                      {
                        name: "checkout.request",
                        ms: latency,
                        w: 78,
                        error: false,
                      },
                      {
                        name: "postgres.query",
                        ms: pressure ? 286 : 24,
                        w: pressure ? 62 : 18,
                        error: false,
                      },
                    ]
                ).map((span, index) => (
                  <div key={span.name}>
                    <span>{span.name}</span>
                    <div>
                      <i
                        className={span.error ? "span-error" : ""}
                        style={{
                          width: `${Math.min(span.w, 96)}%`,
                          marginLeft: `${index * 6}%`,
                        }}
                      />
                    </div>
                    <b>{Math.round(span.ms)} ms</b>
                  </div>
                ))}
              </div>
            </section>

            {report && (
              <section className="panel report-panel">
                <div className="panel-title">
                  <span>
                    <Check size={16} /> After-action report
                  </span>
                  <small>sealed / score {report.score}</small>
                </div>
                <div className={`report-outcome outcome-${report.outcome}`}>
                  <strong>{report.outcome}</strong>
                  <span>{report.summary}</span>
                </div>
                <p className="report-objective">{report.objective}</p>
                <div className="report-findings">
                  {report.findings.map((finding) => (
                    <article key={finding.label}>
                      <b>{finding.label}</b>
                      <span>{finding.detail}</span>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>

        {/* Scenario Catalogue Carousel */}
        <section className="drills-section" id="drills">
          <div className="section-heading">
            <div>
              <p className="kicker">
                <RotateCcw size={15} /> Scenario Catalogue
              </p>
              <h2>Practice the failure, not the diagram.</h2>
            </div>
            <p>
              Each scenario creates real disposable Kubernetes resources, captures telemetry evidence, and tears itself down.
            </p>
          </div>
          <div className="drill-grid">
            {upcomingDrills.map((drill, index) => (
              <article
                key={drill.title}
                className={scenario.id === drill.id ? "drill-selected" : ""}
              >
                <span>0{index + 1}</span>
                <small>{drill.tag}</small>
                <h3>{drill.title}</h3>
                <p>{drill.description}</p>
                <button
                  onClick={() => chooseScenario(drill.id)}
                  disabled={run !== null}
                >
                  {scenario.id === drill.id ? "Selected" : "Load scenario"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="platform-strip" id="platform">
          <span>PROXMOX</span>
          <span>K3S</span>
          <span>ARGO CD</span>
          <span>ENVOY</span>
          <span>LONGHORN</span>
          <span>PROMETHEUS</span>
          <span>LOKI</span>
          <span>OTEL</span>
        </section>
      </main>
    </div>
  );
}

