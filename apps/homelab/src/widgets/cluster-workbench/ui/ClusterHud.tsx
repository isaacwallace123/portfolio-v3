"use client";

import { AlertTriangle, Loader2, Timer, Trash2, X } from "lucide-react";
import type {
  LiveRunView,
  LiveTrace,
  RunComponent,
} from "@/shared/api/live-client";
import { clock } from "../lib/format";
import { SERVICES, type ServiceId } from "../model/topology";
import styles from "../workbench.module.css";

export interface Converging {
  svc: ServiceId;
  want: number;
  have: number;
}

/**
 * The chrome that lives on the canvas itself rather than in a bar above it: identity top-left,
 * clock and teardown top-right, liveness bottom-left, measured signals bottom-right, and the
 * convergence banner in the middle. Keeping it on the canvas is what avoids a second navbar.
 */
export function ClusterHud({
  run,
  components,
  trace,
  drillTitle,
  provisioning,
  flowing,
  stale,
  busy,
  error,
  remainingMs,
  converging,
  onTeardown,
  onDismissError,
}: {
  run: LiveRunView;
  components: RunComponent[];
  trace: LiveTrace | null;
  drillTitle: string | null;
  provisioning: boolean;
  flowing: boolean;
  stale: boolean;
  busy: string | null;
  error: string | null;
  remainingMs: number;
  converging: Converging | undefined;
  onTeardown: () => void;
  onDismissError: () => void;
}) {
  const t = run.telemetry;
  const totalCpu = components.reduce((a, c) => a + c.cpuMillicores, 0);
  const totalMem = components.reduce((a, c) => a + c.memoryMiB, 0);
  const podCount = components.reduce((a, c) => a + c.pods.length, 0);

  return (
    <>
      <div className={styles.hudTopLeft}>
        <span
          className={`${styles.dot} ${provisioning ? styles.dotWarn : styles.dotOk}`}
        />
        <b>Practice cluster</b>
        <code>{run.namespace ?? run.runId}</code>
        {drillTitle && <span className={styles.drillTag}>{drillTitle}</span>}
      </div>

      <div className={styles.hudTopRight}>
        <span
          className={`${styles.hudCard} ${remainingMs < 60_000 ? styles.warnText : ""}`}
          title="Time until this cluster is automatically destroyed"
        >
          <Timer size={13} /> {clock(remainingMs)}
          {!run.renewable && <em className={styles.extended}>extended</em>}
        </span>
        <button
          className={`${styles.hudCard} ${styles.danger}`}
          onClick={onTeardown}
          disabled={busy !== null}
        >
          {busy === "teardown" ? (
            <Loader2 size={13} className={styles.spin} />
          ) : (
            <Trash2 size={13} />
          )}
          Tear down
        </button>
      </div>

      {(converging || busy) && (
        <div className={styles.hudTopCenter} aria-live="polite">
          <span className={styles.convergeChip}>
            <Loader2 size={12} className={styles.spin} />
            {converging ? (
              <>
                {converging.want > converging.have ? "Scaling" : "Draining"}{" "}
                <b>{SERVICES[converging.svc].label}</b> to {converging.want}
                <em>
                  {converging.have} of {converging.want} ready
                </em>
              </>
            ) : (
              <>Applying…</>
            )}
          </span>
        </div>
      )}

      <div className={styles.hudBottomLeft}>
        <span className={flowing ? styles.liveChip : styles.idleChip}>
          <i /> {flowing ? "traffic flowing" : "traffic stopped"}
        </span>
        {stale && (
          <span
            className={styles.staleChip}
            title="The cluster is still there; the page is having trouble reading it."
          >
            <Loader2 size={11} className={styles.spin} /> reconnecting…
          </span>
        )}
        <span>
          {podCount} pods · {components.length} services
        </span>
        {trace && trace.spans.length > 0 && (
          <span>
            trace {trace.durationMs}ms · {trace.release}
          </span>
        )}
      </div>

      <div className={styles.hudBottomRight}>
        <div className={styles.stat}>
          <span>Throughput</span>
          <b>{t.requestsPerSec}/s</b>
        </div>
        <div
          className={`${styles.stat} ${t.p95LatencyMs > t.latencyTargetMs ? styles.statBad : ""}`}
        >
          <span>p95</span>
          <b>{t.p95LatencyMs}ms</b>
        </div>
        <div
          className={`${styles.stat} ${t.errorRatePct > 1 ? styles.statBad : ""}`}
        >
          <span>Errors</span>
          <b>{t.errorRatePct.toFixed(2)}%</b>
        </div>
        <div className={styles.stat}>
          <span>CPU</span>
          <b>{totalCpu}m</b>
        </div>
        <div className={styles.stat}>
          <span>Memory</span>
          <b>{totalMem}Mi</b>
        </div>
        <div className={styles.stat}>
          <span>SLO</span>
          <b>{t.score}</b>
        </div>
      </div>

      {error && (
        <p className={styles.errorFloat} role="alert">
          <AlertTriangle size={13} /> {error}
          <button onClick={onDismissError} aria-label="Dismiss">
            <X size={12} />
          </button>
        </p>
      )}
    </>
  );
}
