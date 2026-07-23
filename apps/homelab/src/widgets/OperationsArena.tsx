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
  Waves,
  Zap,
} from "lucide-react";
import {
  formatRunClock,
  isTerminalPhase,
  type AfterActionReport,
  type EventSeverity,
  type RunTelemetry,
  type RunView,
  type ScenarioCatalog,
} from "@iw/lab-runtime";
import { trafficSpikeScenario, upcomingDrills } from "@/entities/scenario";
import {
  createRun,
  fetchCatalog,
  submitDecision,
  subscribeToRun,
} from "@/shared/lib/runClient";

const severityClass: Record<EventSeverity, string> = {
  info: "event-info",
  success: "event-success",
  warning: "event-warning",
  critical: "event-critical",
};

// Baseline projection shown before a run exists, so the arena reads as a healthy platform at rest.
function baselineTelemetry(): RunTelemetry {
  const m = trafficSpikeScenario.telemetry;
  if (!m || m.kind !== "traffic-spike") {
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
  return {
    requestsPerSec: m.baseline.requestsPerSec,
    p95LatencyMs: m.baseline.p95LatencyMs,
    latencyTargetMs: m.latencyTargetMs,
    errorRatePct: m.baseline.errorRatePct,
    apiReplicas: m.baseline.apiReplicas,
    postgresCpuPct: m.baseline.postgresCpuPct,
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
  const scenario = trafficSpikeScenario;
  const [catalog, setCatalog] = useState<ScenarioCatalog | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [report, setReport] = useState<AfterActionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Capacity read for the platform console + the run-slot gate.
  useEffect(() => {
    let alive = true;
    fetchCatalog()
      .then((c) => alive && setCatalog(c))
      .catch(() => {
        /* console keeps its static defaults */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => unsubscribeRef.current?.(), []);

  const loadReport = useCallback((runId: string) => {
    fetch(`/api/v1/runs/${runId}/report`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && setReport(r as AfterActionReport))
      .catch(() => {
        /* report stays null; evidence panel degrades gracefully */
      });
  }, []);

  const startRun = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    unsubscribeRef.current?.();
    try {
      const idempotencyKey =
        globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`;
      const initial = await createRun(scenario.id, idempotencyKey);
      setRun(initial);
      unsubscribeRef.current = subscribeToRun(initial.runId, {
        onSnapshot: (view) => setRun(view),
        onDone: () => loadReport(initial.runId),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not queue the drill.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, loadReport, scenario.id]);

  const intervene = useCallback(
    async (decisionId: string) => {
      if (!run) return;
      try {
        const updated = await submitDecision(run.runId, decisionId);
        setRun(updated);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Decision was not accepted.",
        );
      }
    },
    [run],
  );

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

  const slotsFree = catalog ? catalog.capacity.slotsAvailable : 1;

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
              Enter a disposable production incident running on a real
              Kubernetes platform. Read the signals, make the call, and leave
              with the evidence.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={startRun}
                disabled={busy || active || (!active && slotsFree === 0)}
              >
                <Play size={17} fill="currentColor" />{" "}
                {busy
                  ? "Queueing…"
                  : active
                    ? "Drill in progress"
                    : run
                      ? "Run it again"
                      : slotsFree === 0
                        ? "All slots busy"
                        : "Queue live drill"}
              </button>
              <a className="text-link" href="#arena">
                Explore the control room <ArrowRight size={15} />
              </a>
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
              <span className="live-dot">LIVE READ MODEL</span>
            </div>
            <div
              className="capacity-ring"
              style={{ "--value": "68%" } as React.CSSProperties}
            >
              <div>
                <strong>68%</strong>
                <span>capacity free</span>
              </div>
            </div>
            <div className="console-grid">
              <span>
                <b>3</b> nodes ready
              </span>
              <span>
                <b>42</b> workloads
              </span>
              <span>
                <b>99.98%</b> platform SLO
              </span>
              <span>
                <b>{slotsFree}</b> drill slot{slotsFree === 1 ? "" : "s"}
              </span>
            </div>
            <p>
              Public controls are allowlisted. Personal workloads remain outside
              the drill boundary.
            </p>
          </div>
        </section>

        <section className="arena-section" id="arena">
          <div className="section-heading" data-lab-reveal>
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
              <span>
                {run?.runId ?? scenario.resourceClass} · 4 vCPU · 6 GiB
              </span>
            </div>
          </div>

          <div className="progress-track">
            <span style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="arena-grid">
            <section
              className="panel topology-panel"
              data-lab-reveal
              data-lab-delay="60"
            >
              <div className="panel-title">
                <span>
                  <CloudCog size={16} /> Runtime topology
                </span>
                <small>namespace / {run?.runId ?? "run-hl-idle"}</small>
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

            <aside
              className="panel decision-panel"
              data-lab-reveal
              data-lab-delay="120"
            >
              <div className="panel-title">
                <span>
                  <CircleGauge size={16} /> Operator console
                </span>
                <small>{phaseLabel}</small>
              </div>
              <p className="decision-intro">
                Interventions become available when the incident begins. Every
                decision is added to the evidence timeline.
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
                    Queue the scenario to provision its isolated namespace.
                  </span>
                </div>
              )}
              {run?.reportReady && (
                <div className="evidence-ready">
                  <Check size={18} />
                  <span>
                    <b>After-action report ready</b>
                    <small>
                      {report
                        ? `${report.outcome} · score ${report.score} · SLO held ${report.sloHeldPct}%`
                        : `${acceptedDecisions.length} operator decisions · ${scenario.events.length} platform events`}
                    </small>
                  </span>
                </div>
              )}
            </aside>

            <section
              className="panel timeline-panel"
              data-lab-reveal
              data-lab-delay="80"
            >
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
                      <p>Action accepted by the scoped run controller.</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section
              className="panel trace-panel"
              data-lab-reveal
              data-lab-delay="140"
            >
              <div className="panel-title">
                <span>
                  <GitBranch size={16} /> Request trace
                </span>
                <small>trace / 7f3a·91bc</small>
              </div>
              <div className="trace-waterfall">
                {[
                  { name: "envoy.gateway", ms: 4, w: 12 },
                  { name: "checkout.http", ms: latency, w: 78 },
                  {
                    name: "catalogue.grpc",
                    ms: Math.max(18, latency * 0.46),
                    w: 44,
                  },
                  {
                    name: "postgres.query",
                    ms: pressure ? 286 : 24,
                    w: pressure ? 62 : 18,
                  },
                ].map((span, index) => (
                  <div key={span.name}>
                    <span>{span.name}</span>
                    <div>
                      <i
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
          </div>
        </section>

        <section className="drills-section" id="drills">
          <div className="section-heading" data-lab-reveal>
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
                data-lab-reveal
                data-lab-delay={index * 80}
              >
                <span>0{index + 2}</span>
                <small>{drill.tag}</small>
                <h3>{drill.title}</h3>
                <p>{drill.description}</p>
                <button disabled>In development</button>
              </article>
            ))}
          </div>
        </section>

        <section className="platform-strip" id="platform" data-lab-reveal>
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
