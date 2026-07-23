"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Boxes,
  Cpu,
  Database,
  MemoryStick,
  Play,
  Radio,
  Layers,
  Trash2,
  Zap,
} from "lucide-react";
import {
  createLiveRun,
  fetchLiveStatus,
  getLiveRun,
  liveDecision,
  teardownLiveRun,
  type LiveRun,
} from "@/shared/lib/liveClient";

const SCENARIO = "checkout-traffic-spike";
const terminal = (s: string) => s === "deleting";

export default function LiveCluster() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetchLiveStatus()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
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
          setRun(await getLiveRun(runId));
        } catch {
          stopPolling();
        }
      }, 3000);
    },
    [stopPolling],
  );

  const provision = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createLiveRun(SCENARIO);
      setRun(created);
      startPolling(created.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not provision.");
    } finally {
      setBusy(false);
    }
  }, [startPolling]);

  const decide = useCallback(
    async (decisionId: string) => {
      if (!run) return;
      setError(null);
      try {
        setRun(await liveDecision(run.runId, decisionId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Decision failed.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teardown failed.");
    } finally {
      setBusy(false);
    }
  }, [run, stopPolling]);

  if (enabled === null) return null;

  const t = run?.telemetry;
  const active = run !== null && !terminal(run.status);
  const scaled = (run?.apiReplicas ?? 3) >= 6;
  const cached = run?.cacheEnabled ?? false;

  return (
    <section className="live-section" id="live">
      <div className="live-wrap">
        <div className="section-heading">
          <div>
            <p className="kicker">
              <Radio size={15} /> Real cluster control
            </p>
            <h2>Provision it for real.</h2>
          </div>
          <p>
            This one is not a simulation. It creates a disposable, isolated
            namespace and workload on the live homelab Kubernetes cluster,
            through the same key-authenticated API any project can integrate.
          </p>
        </div>

        {!enabled ? (
          <div className="panel live-offline">
            <Layers size={18} /> Live provisioning is currently offline.
          </div>
        ) : (
          <div className="panel live-panel">
            <div className="panel-title">
              <span>
                <Boxes size={16} /> {SCENARIO}
              </span>
              <span className="live-badge">
                <i /> LIVE · homelab cluster
              </span>
            </div>

            {!run ? (
              <div className="live-intro">
                <p>
                  Spin up the checkout scenario on real infrastructure. You get
                  an isolated namespace with a quota, a default-deny network
                  boundary, a checkout service, and a load generator — then
                  operate it.
                </p>
                <button
                  className="primary-button"
                  onClick={provision}
                  disabled={busy}
                >
                  <Play size={17} fill="currentColor" />{" "}
                  {busy ? "Provisioning…" : "Provision on the cluster"}
                </button>
              </div>
            ) : (
              <>
                <div className="run-meta">
                  <span className={`status-chip status-${run.status}`}>
                    <i /> {run.status}
                  </span>
                  <span>namespace / {run.namespace ?? run.runId}</span>
                  <span>ttl {Math.round(run.ttlSeconds / 60)}m</span>
                </div>

                <div className="metrics-row">
                  <div className="metric">
                    <span>Checkout replicas</span>
                    <strong>{run.apiReplicas}</strong>
                    <small>desired</small>
                  </div>
                  <div className="metric">
                    <span>Running pods</span>
                    <strong>{t ? t.podCount : "—"}</strong>
                    <small>measured</small>
                  </div>
                  <div className="metric">
                    <span>CPU</span>
                    <strong>{t ? `${t.cpuMillicores}m` : "—"}</strong>
                    <small>metrics-server</small>
                  </div>
                  <div className="metric">
                    <span>Memory</span>
                    <strong>{t ? `${t.memoryMiB} Mi` : "—"}</strong>
                    <small>metrics-server</small>
                  </div>
                </div>

                <div className="live-controls">
                  <button
                    onClick={() => decide("scale")}
                    disabled={!active || scaled}
                  >
                    <Zap size={15} /> Scale API to 6
                  </button>
                  <button
                    onClick={() => decide("cache")}
                    disabled={!active || cached}
                  >
                    <Database size={15} />{" "}
                    {cached ? "Cache active" : "Enable cache tier"}
                  </button>
                  <button
                    className="live-teardown"
                    onClick={teardown}
                    disabled={busy}
                  >
                    <Trash2 size={15} /> Tear down
                  </button>
                </div>

                <div className="live-facts">
                  <span>
                    <Cpu size={13} /> replicas driven by your decision
                  </span>
                  <span>
                    <MemoryStick size={13} /> usage from metrics-server
                  </span>
                  <span>
                    <Database size={13} /> cache tier{" "}
                    {cached ? "provisioned" : "idle"}
                  </span>
                </div>
              </>
            )}

            {error && (
              <p className="hero-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
