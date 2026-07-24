"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Boxes,
  Database,
  Gauge,
  GitBranch,
  Play,
  RefreshCw,
  RotateCcw,
  ServerCog,
  Trash2,
  Waves,
  Zap,
} from "lucide-react";
import {
  createLiveRun,
  getLiveRun,
  practiceAction,
  teardownLiveRun,
  type LiveRunView,
} from "@/shared/lib/liveClient";

const STORAGE_KEY = "homeops-practice-run";

const actionGroups = [
  {
    label: "API replicas",
    actions: [
      ["scale-1", "1 replica"],
      ["scale-3", "3 replicas"],
      ["scale-6", "6 replicas"],
    ],
  },
  {
    label: "Release",
    actions: [
      ["release-stable", "Stable"],
      ["release-candidate", "Bad candidate"],
    ],
  },
  {
    label: "Traffic",
    actions: [
      ["traffic-on", "Start k6"],
      ["traffic-off", "Stop k6"],
    ],
  },
  {
    label: "Cache tier",
    actions: [
      ["cache-on", "Enable Redis"],
      ["cache-off", "Disable Redis"],
    ],
  },
  {
    label: "Placement",
    actions: [
      ["move-apps", "Apps worker"],
      ["move-infra", "Infra worker"],
    ],
  },
] as const;

export default function PracticeCluster() {
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (runId: string) => {
    try {
      const next = await getLiveRun(runId);
      setRun(next);
      setError(null);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setRun(null);
    }
  }, []);

  useEffect(() => {
    const remembered = window.localStorage.getItem(STORAGE_KEY);
    const timer = remembered
      ? window.setTimeout(() => void refresh(remembered), 0)
      : null;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => void refresh(run.runId), 2500);
    return () => window.clearInterval(timer);
  }, [refresh, run]);

  const launch = async () => {
    setBusy("launch");
    setError(null);
    try {
      const created = await createLiveRun("practice-cluster");
      window.localStorage.setItem(STORAGE_KEY, created.runId);
      setRun(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace launch failed.");
    } finally {
      setBusy(null);
    }
  };

  const act = async (actionId: string) => {
    if (!run) return;
    setBusy(actionId);
    setError(null);
    try {
      setRun(await practiceAction(run.runId, actionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action was rejected.");
    } finally {
      setBusy(null);
    }
  };

  const teardown = async () => {
    if (!run) return;
    setBusy("teardown");
    setError(null);
    try {
      await teardownLiveRun(run.runId);
      window.localStorage.removeItem(STORAGE_KEY);
      setRun(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teardown failed.");
    } finally {
      setBusy(null);
    }
  };

  const pods = run?.podCount;
  const ready = run?.status === "running";

  return (
    <main className="practice-page">
      <section className="practice-hero">
        <div>
          <p className="kicker">
            <ServerCog size={15} /> Disposable practice workspace
          </p>
          <h1>
            Bring it up. <em>Mess with it.</em> Tear it down.
          </h1>
          <p>
            This provisions a real namespace on the homelab K3s cluster. It is
            an isolated application workspace—not a simulated terminal and not
            unrestricted access to the host cluster.
          </p>
        </div>
        <div className="practice-boundary">
          <strong>PUBLIC SAFETY BOUNDARY</strong>
          <span>Allowlisted images and operations</span>
          <span>Resource quota + network policy</span>
          <span>15-minute hard TTL</span>
          <span>No secrets, shell, manifests, or host access</span>
        </div>
      </section>

      {!run ? (
        <section className="practice-launch-card">
          <div className="practice-stack-preview">
            <span>
              <Waves size={18} /> k6
            </span>
            <i />
            <span>
              <GitBranch size={18} /> Envoy
            </span>
            <i />
            <span>
              <Boxes size={18} /> Checkout API
            </span>
            <i />
            <span>
              <Database size={18} /> Postgres + Redis
            </span>
          </div>
          <div>
            <small>REAL RESOURCES / ZERO UNTIL LAUNCHED</small>
            <h2>Your sandbox does not exist yet.</h2>
            <p>
              Launching creates the namespace, quota, policies, database,
              gateway, application, optional cache, and load generator through
              Crossplane.
            </p>
            <button
              className="primary-button"
              onClick={launch}
              disabled={busy !== null}
            >
              {busy === "launch" ? (
                <RefreshCw size={17} className="spin" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {busy === "launch" ? "Requesting workspace…" : "Launch workspace"}
            </button>
          </div>
        </section>
      ) : (
        <section className="practice-console">
          <div className="practice-console-head">
            <div>
              <span className={`practice-state state-${run.status}`}>
                <i /> {run.status}
              </span>
              <h2>Practice workspace</h2>
              <small>isolated namespace / broker-issued identity</small>
            </div>
            <button onClick={teardown} disabled={busy !== null}>
              <Trash2 size={15} /> Tear down
            </button>
          </div>

          <div className="practice-runtime">
            <div className="practice-runtime-map">
              <article className={run.loadEnabled ? "is-active" : ""}>
                <Waves size={18} />
                <b>k6 load</b>
                <small>{run.loadEnabled ? "running" : "scaled to zero"}</small>
              </article>
              <Zap size={16} />
              <article className={ready ? "is-active" : ""}>
                <GitBranch size={18} />
                <b>Envoy</b>
                <small>{ready ? "routing" : "reconciling"}</small>
              </article>
              <Zap size={16} />
              <article
                className={
                  run.releaseTrack === "candidate"
                    ? "is-danger"
                    : ready
                      ? "is-active"
                      : ""
                }
              >
                <Boxes size={18} />
                <b>Checkout API</b>
                <small>
                  {run.telemetry.apiReplicas} replicas · {run.releaseTrack}
                </small>
              </article>
              <Zap size={16} />
              <div className="practice-data-stack">
                <article className={ready ? "is-active" : ""}>
                  <Database size={18} />
                  <b>Postgres</b>
                  <small>{run.dataState}</small>
                </article>
                <article
                  className={run.telemetry.cacheActive ? "is-active" : ""}
                >
                  <Database size={18} />
                  <b>Redis</b>
                  <small>
                    {run.telemetry.cacheActive ? "running" : "scaled to zero"}
                  </small>
                </article>
              </div>
            </div>
            <div className="practice-live-metrics">
              <span>
                <small>Measured pods</small>
                <b>{pods ?? "—"}</b>
              </span>
              <span>
                <small>CPU</small>
                <b>{run.cpuMillicores ?? "—"}m</b>
              </span>
              <span>
                <small>Memory</small>
                <b>{run.memoryMiB ?? "—"} MiB</b>
              </span>
              <span>
                <small>Requests</small>
                <b>{run.telemetry.requestsPerSec}/s</b>
              </span>
              <span>
                <small>p95</small>
                <b>{run.telemetry.p95LatencyMs} ms</b>
              </span>
              <span>
                <small>Errors</small>
                <b>{run.telemetry.errorRatePct.toFixed(2)}%</b>
              </span>
            </div>
          </div>

          <div className="practice-controls">
            <div className="practice-controls-head">
              <div>
                <p className="kicker">
                  <Gauge size={14} /> Real reconciliation controls
                </p>
                <h3>Change desired state</h3>
              </div>
              <span>
                {busy ? `applying ${busy}…` : "ready for an operation"}
              </span>
            </div>
            <div className="practice-action-groups">
              {actionGroups.map((group) => (
                <fieldset key={group.label}>
                  <legend>{group.label}</legend>
                  {group.actions.map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => act(id)}
                      disabled={busy !== null}
                    >
                      {label}
                    </button>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="practice-utility-actions">
              <button onClick={() => act("restart")} disabled={busy !== null}>
                <RefreshCw size={15} /> Rollout restart
              </button>
              <button onClick={() => act("reset")} disabled={busy !== null}>
                <RotateCcw size={15} /> Reset baseline
              </button>
            </div>
          </div>
        </section>
      )}
      {error && (
        <p className="practice-error" role="alert">
          {error}
        </p>
      )}
      <section className="practice-how">
        <article>
          <Activity size={18} />
          <h3>Observe reconciliation</h3>
          <p>
            Controls patch the LabRun desired state. Crossplane reconciles the
            resulting Kubernetes resources and this page polls measured state.
          </p>
        </article>
        <article>
          <GitBranch size={18} />
          <h3>Compare releases</h3>
          <p>
            The candidate is intentionally regressed. Turn on traffic and watch
            the real request latency and error rate react.
          </p>
        </article>
        <article>
          <Gauge size={18} />
          <h3>Change one variable</h3>
          <p>
            Scale, cache, move, or restart the stack and use the measured
            signals to explain what Kubernetes actually changed.
          </p>
        </article>
      </section>
    </main>
  );
}
