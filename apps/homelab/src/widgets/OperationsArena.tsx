"use client";

import { useEffect, useMemo, useState } from "react";
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
  getRunSnapshot,
  type EventSeverity,
  type RunStatus,
} from "@iw/lab-runtime";
import { trafficSpikeScenario, upcomingDrills } from "@/entities/scenario";

const severityClass: Record<EventSeverity, string> = {
  info: "event-info",
  success: "event-success",
  warning: "event-warning",
  critical: "event-critical",
};

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

function StatusChip({ status }: { status: RunStatus }) {
  return (
    <span className={`status-chip status-${status}`}>
      <i /> {status}
    </span>
  );
}

export default function OperationsArena() {
  const scenario = trafficSpikeScenario;
  const [status, setStatus] = useState<RunStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [actions, setActions] = useState<string[]>([]);

  const snapshot = useMemo(
    () => getRunSnapshot(scenario, elapsedMs),
    [elapsedMs, scenario],
  );

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => {
      setElapsedMs((current) => Math.min(current + 1_000, scenario.durationMs));
    }, 500);
    return () => window.clearInterval(timer);
  }, [scenario.durationMs, status]);

  useEffect(() => {
    if (status === "queued") {
      const timer = window.setTimeout(() => setStatus("provisioning"), 700);
      return () => window.clearTimeout(timer);
    }
    if (status === "provisioning") {
      const timer = window.setTimeout(() => setStatus("running"), 900);
      return () => window.clearTimeout(timer);
    }
    if (status === "running" && snapshot.complete) {
      const timer = window.setTimeout(() => setStatus("collecting"), 0);
      return () => window.clearTimeout(timer);
    }
    if (status === "collecting") {
      const timer = window.setTimeout(() => setStatus("complete"), 1_100);
      return () => window.clearTimeout(timer);
    }
  }, [snapshot.complete, status]);

  const startRun = () => {
    setElapsedMs(0);
    setActions([]);
    setStatus("queued");
  };

  const intervene = (action: string) => {
    setActions((current) =>
      current.includes(action) ? current : [...current, action],
    );
  };

  const incident = elapsedMs >= 15_000 && elapsedMs < 39_000;
  const scaled = actions.includes("scale") || elapsedMs >= 31_000;
  const cached = actions.includes("cache");
  const rolledBack = actions.includes("rollback");
  const pressure = incident && !scaled && !cached && !rolledBack;
  const requests = elapsedMs < 15_000 ? 118 : elapsedMs < 40_000 ? 942 : 684;
  const latency =
    elapsedMs < 15_000 ? 43 : pressure ? 684 : cached ? 71 : scaled ? 104 : 116;
  const errors =
    elapsedMs < 15_000 ? 0.02 : pressure ? 7.8 : rolledBack ? 0.08 : 0.21;
  const score = Math.max(
    0,
    100 -
      (pressure ? 31 : 0) -
      (elapsedMs > 25_000 && actions.length === 0 ? 12 : 0),
  );

  return (
    <div className="site-frame">
      <main id="top">
        <section className="hero">
          <div className="hero-copy">
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
                disabled={status !== "idle" && status !== "complete"}
              >
                <Play size={17} fill="currentColor" />{" "}
                {status === "idle"
                  ? "Queue live drill"
                  : status === "complete"
                    ? "Run it again"
                    : "Drill in progress"}
              </button>
              <a className="text-link" href="#arena">
                Explore the control room <ArrowRight size={15} />
              </a>
            </div>
          </div>
          <div className="hero-console" aria-label="Current platform status">
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
                <b>1</b> drill slot
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
            <span style={{ width: `${snapshot.progress * 100}%` }} />
          </div>

          <div className="arena-grid">
            <section className="panel topology-panel">
              <div className="panel-title">
                <span>
                  <CloudCog size={16} /> Runtime topology
                </span>
                <small>namespace / run-hl-2407</small>
              </div>
              <div className="topology-flow">
                <div className="topology-node edge">
                  <Zap size={18} />
                  <b>k6 edge</b>
                  <small>{requests} req/s</small>
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
                  <small>{scaled ? 6 : 3} replicas</small>
                  <div className="pod-row">
                    {Array.from({ length: scaled ? 6 : 3 }).map((_, index) => (
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
                    <small>{pressure ? "86% CPU" : "healthy"}</small>
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
                  value={`${requests}/s`}
                  detail="edge throughput"
                />
                <Metric
                  label="p95 latency"
                  value={`${latency} ms`}
                  detail="target < 120 ms"
                  tone={latency > 120 ? "warn" : "good"}
                />
                <Metric
                  label="Error rate"
                  value={`${errors.toFixed(2)}%`}
                  detail="5xx responses"
                  tone={errors > 1 ? "warn" : "good"}
                />
                <Metric
                  label="Run score"
                  value={`${score}`}
                  detail="SLO + decisions"
                  tone={score > 85 ? "good" : "warn"}
                />
              </div>
            </section>

            <aside className="panel decision-panel">
              <div className="panel-title">
                <span>
                  <CircleGauge size={16} /> Operator console
                </span>
                <small>{snapshot.phase}</small>
              </div>
              <p className="decision-intro">
                Interventions become available when the incident begins. Every
                decision is added to the evidence timeline.
              </p>
              <div className="decision-list">
                {scenario.decisions.map((decision) => {
                  const selected = actions.includes(decision.id);
                  const available =
                    status === "running" &&
                    elapsedMs >= decision.availableAfterMs;
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
              {status === "complete" && (
                <div className="evidence-ready">
                  <Check size={18} />
                  <span>
                    <b>After-action report ready</b>
                    <small>
                      {actions.length} operator decisions · 8 platform events
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
                {snapshot.visibleEvents.length === 0 ? (
                  <div className="timeline-empty">
                    Events will stream here when the run begins.
                  </div>
                ) : (
                  snapshot.visibleEvents
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
                {actions.map((action, index) => (
                  <article key={action} className="event-operator">
                    <time>
                      {formatRunClock(
                        Math.max(
                          15_000,
                          elapsedMs - (actions.length - index) * 1_000,
                        ),
                      )}
                    </time>
                    <i />
                    <div>
                      <span>operator</span>
                      <b>
                        {
                          scenario.decisions.find((item) => item.id === action)
                            ?.label
                        }
                      </b>
                      <p>Action accepted by the scoped run controller.</p>
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
              <article key={drill.title}>
                <span>0{index + 2}</span>
                <small>{drill.tag}</small>
                <h3>{drill.title}</h3>
                <p>{drill.description}</p>
                <button disabled>In development</button>
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
