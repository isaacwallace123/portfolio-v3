"use client";

import {
  Activity,
  Check,
  Circle,
  CloudCog,
  Loader2,
  Radio,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";
import type { RankedLaunchReadiness } from "../model/launch";
import styles from "../ranked.module.css";

const STEPS = [
  {
    id: "namespace",
    label: "Isolate arena",
    description: "Namespace, identity, and network boundary",
    icon: CloudCog,
  },
  {
    id: "workloads",
    label: "Start workloads",
    description: "Application, gateways, data, and load",
    icon: ServerCog,
  },
  {
    id: "telemetry",
    label: "Verify instruments",
    description: "Traffic, metrics, events, and traces",
    icon: Activity,
  },
  {
    id: "incident",
    label: "Activate incident",
    description: "Draw and commit the rating-matched fault",
    icon: Radio,
  },
] as const;

export function RankedLaunchScreen({
  readiness,
  activating,
  error,
  runId,
  onCancel,
  onRetry,
}: {
  readiness: RankedLaunchReadiness;
  activating: boolean;
  error: string | null;
  runId: string | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const completed = {
    namespace: readiness.namespaceReady,
    workloads: readiness.workloadsReady,
    telemetry: readiness.telemetryReady,
    incident: false,
  };
  const active =
    activating || readiness.ready
      ? "incident"
      : readiness.phase === "telemetry"
        ? "telemetry"
        : readiness.phase === "workloads"
          ? "workloads"
          : "namespace";

  return (
    <main className={styles.launchPage}>
      <div className={styles.launchGlow} />
      <section className={styles.launchCard} aria-live="polite">
        <header className={styles.launchHeader}>
          <span className={styles.launchMark}>
            <Loader2 className={styles.spin} size={19} />
          </span>
          <div>
            <p>
              <ShieldCheck size={12} /> Secure launch sequence
            </p>
            <h1>Preparing your ranked arena</h1>
            <span>
              The match clock stays at 00:00 until the environment passes every
              readiness check.
            </span>
          </div>
        </header>

        <div className={styles.launchSteps}>
          {STEPS.map(({ id, label, description, icon: Icon }) => {
            const done = completed[id];
            const current = active === id;
            return (
              <article
                key={id}
                data-state={done ? "done" : current ? "active" : "waiting"}
              >
                <i>{done ? <Check size={14} /> : <Icon size={14} />}</i>
                <div>
                  <b>{label}</b>
                  <span>{description}</span>
                </div>
                {current ? (
                  <Loader2 className={styles.spin} size={13} />
                ) : (
                  <Circle size={8} />
                )}
              </article>
            );
          })}
        </div>

        <div className={styles.launchTelemetry}>
          <div>
            <span>Run</span>
            <code>{runId ?? "allocating"}</code>
          </div>
          <div>
            <span>Workloads</span>
            <b>
              {readiness.readyPods}/{readiness.desiredPods || "—"} ready
            </b>
          </div>
          <div>
            <span>Match clock</span>
            <b>00:00 · paused</b>
          </div>
        </div>

        <footer className={styles.launchFooter}>
          <p className={error ? styles.launchError : ""}>
            {error ?? readiness.detail}
          </p>
          <div>
            {error && (
              <button type="button" onClick={onRetry}>
                Retry check
              </button>
            )}
            <button
              type="button"
              className={styles.launchCancel}
              onClick={onCancel}
            >
              <X size={12} /> Cancel setup
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
