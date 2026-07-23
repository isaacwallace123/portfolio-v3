"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  DatabaseZap,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  Play,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  Thermometer,
  Timer,
  WandSparkles,
} from "lucide-react";
import {
  formatRunClock,
  getRunSnapshot,
  type RunStatus,
} from "@iw/lab-runtime";
import {
  agentArenaExperiment,
  agentLogs,
  pipelineStages,
} from "@/entities/experiment";

const tasks = [
  { id: "repair", label: "Code repair", detail: "Fix a timestamp regression" },
  {
    id: "rag",
    label: "RAG challenge",
    detail: "Ground an infrastructure answer",
  },
  {
    id: "tool",
    label: "Tool benchmark",
    detail: "Complete a safe API workflow",
  },
];

function AgentLane({
  name,
  route,
  gpu,
  elapsedMs,
  accent,
  hinted,
}: {
  name: "primary" | "fast";
  route: string;
  gpu: string;
  elapsedMs: number;
  accent: "violet" | "cyan";
  hinted: boolean;
}) {
  const logs = agentLogs[name].filter((log) => log.at <= elapsedMs);
  const done = elapsedMs >= 43_000;
  const score = name === "primary" ? 96 : hinted ? 92 : 78;

  return (
    <article className={`agent-lane lane-${accent}`}>
      <header>
        <div className="agent-avatar">
          <Bot size={20} />
        </div>
        <div>
          <small>{route}</small>
          <h3>{name === "primary" ? "Agent A" : "Agent B"}</h3>
        </div>
        <span className="lane-state">
          <i /> {done ? "judged" : elapsedMs > 8_000 ? "working" : "waiting"}
        </span>
      </header>
      <div className="agent-model">
        <span>Qwen3 8B · Q4_K_M</span>
        <span>{gpu}</span>
      </div>
      <div className="terminal-feed">
        {logs.length === 0 ? (
          <p className="terminal-wait">Awaiting model route…</p>
        ) : (
          logs.map((log, index) => (
            <div key={`${log.at}-${index}`} className={`log-${log.kind}`}>
              <time>{formatRunClock(log.at)}</time>
              <span>{log.kind}</span>
              <code>{log.text}</code>
            </div>
          ))
        )}
        {hinted && (
          <div className="log-hint">
            <time>USER</time>
            <span>hint</span>
            <code>
              Inspect timezone normalization before changing output format.
            </code>
          </div>
        )}
      </div>
      <div className="agent-stats">
        <span>
          <small>tokens</small>
          <b>
            {Math.min(
              Math.round(elapsedMs * (name === "primary" ? 0.026 : 0.031)),
              name === "primary" ? 1214 : 1438,
            )}
          </b>
        </span>
        <span>
          <small>tok/s</small>
          <b>{name === "primary" ? "31.4" : "38.9"}</b>
        </span>
        <span>
          <small>tests</small>
          <b>
            {elapsedMs < 27_000
              ? "—"
              : name === "primary"
                ? "18/18"
                : hinted
                  ? "18/18"
                  : "17/18"}
          </b>
        </span>
        <span>
          <small>score</small>
          <b>{done ? score : "—"}</b>
        </span>
      </div>
    </article>
  );
}

export default function ExperimentArena() {
  const experiment = agentArenaExperiment;
  const [task, setTask] = useState("repair");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hints, setHints] = useState<string[]>([]);
  const snapshot = useMemo(
    () => getRunSnapshot(experiment, elapsedMs),
    [elapsedMs, experiment],
  );

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(
      () =>
        setElapsedMs((value) => Math.min(value + 1_000, experiment.durationMs)),
      500,
    );
    return () => window.clearInterval(timer);
  }, [experiment.durationMs, status]);

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

  const start = () => {
    setStatus("queued");
    setElapsedMs(0);
    setHints([]);
  };
  const canHint =
    status === "running" && elapsedMs >= 18_000 && elapsedMs < 40_000;

  return (
    <div className="ai-site">
      <main id="top">
        <section className="ai-hero">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="ai-hero-copy">
            <p className="ai-kicker">
              <FlaskConical size={15} /> Local intelligence, under observation
            </p>
            <h1>
              Run the model.
              <br />
              <span>Inspect the system.</span>
            </h1>
            <p>
              Configure real experiments across two local GPU workers. Watch
              agents reason through tools, compare their artifacts, and audit
              the evaluator—not merely the answer.
            </p>
            <div className="ai-actions">
              <button
                onClick={start}
                disabled={status !== "idle" && status !== "complete"}
              >
                <Play size={17} fill="currentColor" />{" "}
                {status === "complete"
                  ? "Replay experiment"
                  : status === "idle"
                    ? "Queue experiment"
                    : "Experiment running"}
              </button>
              <a href="#arena">
                Open workbench <ArrowRight size={15} />
              </a>
            </div>
          </div>
          <div className="hero-model-stack">
            <div className="model-card card-back">
              <span>B50 · 16 GB</span>
              <b>local-primary</b>
              <small>31.4 tokens / second</small>
            </div>
            <div className="model-card card-front">
              <span>B580 · 12 GB</span>
              <b>local-fast</b>
              <small>38.9 tokens / second</small>
              <div className="token-stream">
                101&nbsp; 011&nbsp; 001&nbsp; 110&nbsp; 010
              </div>
            </div>
            <div className="model-pulse">
              <Sparkles size={18} />
            </div>
          </div>
        </section>

        <section className="workbench" id="arena">
          <div className="workbench-title">
            <div>
              <p className="ai-kicker">
                <GitCompareArrows size={15} /> Dual-agent arena
              </p>
              <h2>{experiment.title}</h2>
            </div>
            <div className="experiment-state">
              <span className={`ai-status status-${status}`}>
                <i />
                {status}
              </span>
              <span>
                {formatRunClock(elapsedMs)} /{" "}
                {formatRunClock(experiment.durationMs)}
              </span>
              <span>fixture adapter · public-safe</span>
            </div>
          </div>

          <div className="experiment-progress">
            <span style={{ width: `${snapshot.progress * 100}%` }} />
          </div>
          <div className="pipeline-rail">
            {pipelineStages.map((stage, index) => {
              const complete = elapsedMs >= stage.at;
              const next = pipelineStages[index + 1];
              const active = complete && (!next || elapsedMs < next.at);
              return (
                <div
                  key={stage.id}
                  className={`${complete ? "stage-complete" : ""} ${active ? "stage-active" : ""}`}
                >
                  <span>{complete ? <Check size={13} /> : index + 1}</span>
                  <b>{stage.label}</b>
                  {index < pipelineStages.length - 1 && <i />}
                </div>
              );
            })}
          </div>

          <div className="experiment-grid">
            <aside className="experiment-config">
              <div className="config-title">
                <WandSparkles size={16} />
                <span>Experiment setup</span>
              </div>
              <label>Benchmark task</label>
              <div className="task-options">
                {tasks.map((item) => (
                  <button
                    key={item.id}
                    className={task === item.id ? "active" : ""}
                    onClick={() => setTask(item.id)}
                    disabled={status !== "idle" && status !== "complete"}
                  >
                    <span>
                      <Code2 size={15} />
                    </span>
                    <span>
                      <b>{item.label}</b>
                      <small>{item.detail}</small>
                    </span>
                    {item.id !== "repair" && <em>soon</em>}
                  </button>
                ))}
              </div>
              <label>Shared constraints</label>
              <div className="constraint-list">
                <span>
                  <Timer size={14} /> 4 minute ceiling
                </span>
                <span>
                  <Gauge size={14} /> 2,048 token budget
                </span>
                <span>
                  <TerminalSquare size={14} /> allowlisted tools
                </span>
                <span>
                  <DatabaseZap size={14} /> network disabled
                </span>
              </div>
              <label>Human intervention</label>
              <div className="hint-buttons">
                <button
                  onClick={() =>
                    setHints((current) =>
                      current.includes("primary")
                        ? current
                        : [...current, "primary"],
                    )
                  }
                  disabled={!canHint || hints.includes("primary")}
                >
                  Hint Agent A
                </button>
                <button
                  onClick={() =>
                    setHints((current) =>
                      current.includes("fast") ? current : [...current, "fast"],
                    )
                  }
                  disabled={!canHint || hints.includes("fast")}
                >
                  Hint Agent B
                </button>
              </div>
              <p className="config-note">
                <CircleDot size={12} /> Every intervention is included in the
                final evaluation report.
              </p>
            </aside>

            <div className="agent-arena">
              <AgentLane
                name="primary"
                route="local-primary"
                gpu="Arc Pro B50 · 16 GB"
                elapsedMs={elapsedMs}
                accent="violet"
                hinted={hints.includes("primary")}
              />
              <div className="versus">VS</div>
              <AgentLane
                name="fast"
                route="local-fast"
                gpu="Arc B580 · 12 GB"
                elapsedMs={elapsedMs}
                accent="cyan"
                hinted={hints.includes("fast")}
              />
            </div>

            <section className="telemetry-panel">
              <header>
                <span>
                  <Activity size={15} /> Inference telemetry
                </span>
                <small>sampled / 1 s</small>
              </header>
              <div className="gpu-cards">
                <div>
                  <span className="gpu-name">
                    <i className="violet" /> B50 worker
                  </span>
                  <b>
                    {status === "running" && elapsedMs > 8_000 ? "92" : "04"}
                    <small>% GPU</small>
                  </b>
                  <div className="micro-chart violet-chart">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <footer>
                    <span>
                      <Thermometer size={12} />{" "}
                      {status === "running" ? "67°C" : "38°C"}
                    </span>
                    <span>11.8 / 16 GB</span>
                  </footer>
                </div>
                <div>
                  <span className="gpu-name">
                    <i className="cyan" /> B580 worker
                  </span>
                  <b>
                    {status === "running" && elapsedMs > 8_000 ? "96" : "03"}
                    <small>% GPU</small>
                  </b>
                  <div className="micro-chart cyan-chart">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <footer>
                    <span>
                      <Thermometer size={12} />{" "}
                      {status === "running" ? "71°C" : "36°C"}
                    </span>
                    <span>9.4 / 12 GB</span>
                  </footer>
                </div>
              </div>
            </section>

            <section className="judge-panel">
              <header>
                <span>
                  <Check size={15} /> Deterministic judge
                </span>
                <small>
                  {elapsedMs >= 43_000 ? "complete" : "waiting for artifacts"}
                </small>
              </header>
              <div className="judge-grid">
                {[
                  {
                    label: "Correctness",
                    a: elapsedMs >= 43_000 ? 100 : 0,
                    b:
                      elapsedMs >= 43_000
                        ? hints.includes("fast")
                          ? 100
                          : 94
                        : 0,
                  },
                  { label: "Patch scope", a: 94, b: 88 },
                  { label: "Efficiency", a: 86, b: 97 },
                  { label: "Tool safety", a: 100, b: 100 },
                ].map((metric) => (
                  <div key={metric.label}>
                    <span>{metric.label}</span>
                    <div className="score-bars">
                      <i
                        style={{
                          width: `${elapsedMs >= 43_000 ? metric.a : 0}%`,
                        }}
                      />
                      <i
                        style={{
                          width: `${elapsedMs >= 43_000 ? metric.b : 0}%`,
                        }}
                      />
                    </div>
                    <b>
                      {elapsedMs >= 43_000
                        ? `${metric.a} / ${metric.b}`
                        : "— / —"}
                    </b>
                  </div>
                ))}
              </div>
              {status === "complete" && (
                <div className="winner">
                  <Sparkles size={18} />
                  <span>
                    <small>Experiment winner</small>
                    <b>
                      {hints.includes("fast")
                        ? "Technical tie · Agent B was faster"
                        : "Agent A · all hidden tests passed"}
                    </b>
                  </span>
                  <button>
                    <RotateCcw size={14} /> Inspect report
                  </button>
                </div>
              )}
            </section>
          </div>
        </section>

        <section className="rag-section" id="pipeline">
          <div className="rag-copy">
            <p className="ai-kicker">
              <DatabaseZap size={15} /> RAG pipeline forge
            </p>
            <h2>
              Change one decision.
              <br />
              Measure every consequence.
            </h2>
            <p>
              Compose retrieval experiments from approved datasets, then compare
              grounding, latency, citations, and power consumption against a
              recorded baseline.
            </p>
            <button disabled>
              Open pipeline builder · next slice <ChevronRight size={15} />
            </button>
          </div>
          <div className="rag-canvas">
            {[
              {
                icon: <DatabaseZap size={17} />,
                name: "Lab docs",
                sub: "3 collections",
              },
              {
                icon: <Code2 size={17} />,
                name: "Chunk",
                sub: "512 · overlap 64",
              },
              {
                icon: <BrainCircuit size={17} />,
                name: "Embed",
                sub: "candidate A",
              },
              {
                icon: <GitCompareArrows size={17} />,
                name: "Rerank",
                sub: "top 12 → 4",
              },
              {
                icon: <Sparkles size={17} />,
                name: "Generate",
                sub: "local-auto",
              },
            ].map((node, index) => (
              <div key={node.name} className="rag-node">
                <span>{node.icon}</span>
                <b>{node.name}</b>
                <small>{node.sub}</small>
                {index < 4 && <ArrowRight />}
              </div>
            ))}
            <div className="rag-score">
              <span>GROUNDING</span>
              <b>94.2</b>
              <small>+7.8 vs baseline</small>
            </div>
          </div>
        </section>

        <section className="model-registry" id="registry">
          <span>LLAMA.CPP / VULKAN</span>
          <span>LITELLM</span>
          <span>QWEN3 8B</span>
          <span>POSTGRES / PGVECTOR</span>
          <span>OPEN WEBUI</span>
          <span>OTEL TRACES</span>
          <span>2× INTEL ARC</span>
        </section>
      </main>
    </div>
  );
}
