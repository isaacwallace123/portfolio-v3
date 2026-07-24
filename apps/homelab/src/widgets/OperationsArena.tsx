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
  RotateCcw,
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

// No run means no workload and therefore no workload telemetry. Showing zeroes is intentional:
// the arena never substitutes a designed baseline for a measurement.
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

export default function OperationsArena() {
  const [scenarioId, setScenarioId] = useState(trafficSpikeScenario.id);
  const scenario = getHomelabScenario(scenarioId);
  const [liveEnabled, setLiveEnabled] = useState<boolean | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [report, setReport] = useState<LiveReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
              <Waves size={15} /> Interactive platform engineering
            </p>
            <h1>
              Don&apos;t tour the infrastructure. <em>Operate it.</em>
            </h1>
            <p className="hero-lede">
              Queue a disposable production incident on the{" "}
              <strong>live homelab Kubernetes cluster</strong>. A real isolated
              namespace and workload spin up; read the signals, make the call,
              and tear it down.
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
                        : "Queue live drill"}
              </button>
              {run ? (
                <button
                  className="text-link"
                  onClick={teardown}
                  disabled={busy}
                >
                  <Trash2 size={15} /> Tear down
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
                  ? "LIVE CLUSTER"
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
              Public controls are allowlisted. Personal workloads remain outside
              the drill boundary.
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
            <section className="panel topology-panel">
              <div className="panel-title">
                <span>
                  <CloudCog size={16} /> Runtime topology
                </span>
                <small>namespace / {namespace}</small>
              </div>
              <div className="topology-flow">
                <div className="topology-node edge">
                  <Zap size={18} />
                  <b>k6 edge</b>
                  <small>{tel.requestsPerSec} req/s</small>
                </div>
                <ArrowRight className="flow-arrow" />
                <div className="topology-node">
                  <GitBranch size={18} />
                  <b>Envoy</b>
                  <small>gateway</small>
                </div>
                <ArrowRight className="flow-arrow" />
                <div
                  className={`topology-node api ${pressure ? "node-hot" : ""}`}
                >
                  <Box size={18} />
                  <b>Checkout API</b>
                  <small>{tel.apiReplicas} replicas</small>
                  <div className="pod-row">
                    {Array.from({ length: tel.apiReplicas }).map((_, index) => (
                      <i key={index} />
                    ))}
                  </div>
                </div>
                <ArrowRight className="flow-arrow" />
                <div className="data-stack">
                  <div
                    className={`topology-node ${pressure ? "node-warn" : ""}`}
                  >
                    <Database size={17} />
                    <b>Postgres</b>
                    <small>
                      {pressure ? `${tel.postgresCpuPct}% CPU` : "healthy"}
                    </small>
                  </div>
                  <div className={`topology-node ${cached ? "node-good" : ""}`}>
                    <Database size={17} />
                    <b>Redis</b>
                    <small>{cached ? "cache active" : "standby"}</small>
                  </div>
                </div>
              </div>
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

            <aside className="panel decision-panel">
              <div className="panel-title">
                <span>
                  <CircleGauge size={16} /> Operator console
                </span>
                <small>{phaseLabel}</small>
              </div>
              <p className="decision-intro">
                Interventions become available when the incident begins. Each
                decision changes the <strong>real</strong> workload —
                deployments roll, capacity changes, or placement reconciles.
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
              {status === "idle" && (
                <div className="console-empty">
                  <TimerReset size={22} />
                  <b>No active drill</b>
                  <span>
                    {liveEnabled === false
                      ? "Live provisioning is currently offline."
                      : "Queue the scenario to provision its isolated namespace."}
                  </span>
                </div>
              )}
              {active && (
                <div className="evidence-ready">
                  <Check size={18} />
                  <span>
                    <b>Live on the cluster</b>
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

            <section className="panel timeline-panel">
              <div className="panel-title">
                <span>
                  <Activity size={16} /> Correlated event stream
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

            <section className="panel trace-panel">
              <div className="panel-title">
                <span>
                  <GitBranch size={16} /> Request trace
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

        <section className="drills-section" id="drills">
          <div className="section-heading">
            <div>
              <p className="kicker">
                <RotateCcw size={15} /> Scenario catalogue
              </p>
              <h2>Practice the failure, not the diagram.</h2>
            </div>
            <p>
              Each drill creates real disposable resources, captures evidence,
              and tears itself down.
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
