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
import type { RankedLaunchView } from "@/shared/api/live-client";
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
  {
    id: "active",
    label: "Open workspace",
    description: "Hand off to the live measured environment",
    icon: ShieldCheck,
  },
] as const;

export function RankedLaunchScreen({
  launch,
  busy,
  error,
  onCancel,
  onRetry,
}: {
  launch: RankedLaunchView | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const activeIndex =
    launch?.phase === "starting-workloads"
      ? 1
      : launch?.phase === "verifying-telemetry"
        ? 2
        : launch?.phase === "activating-incident"
          ? 3
          : launch?.phase === "active"
            ? 4
            : 0;
  const failed = launch?.failed ?? false;
  const launchSeconds = launch?.launchElapsedSeconds ?? 0;
  const launchBudget = launch?.launchBudgetSeconds ?? 0;

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
            <h1>{launch?.title ?? "Preparing your ranked arena"}</h1>
            <span>
              The match clock stays at 00:00 until the environment passes every
              readiness check.
            </span>
          </div>
        </header>

        <div className={styles.launchSteps}>
          {STEPS.map(({ id, label, description, icon: Icon }, index) => {
            const done = !failed && index < activeIndex;
            const current = !failed && index === activeIndex;
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

        {launch && launch.checks.length > 0 && (
          <div className={styles.launchChecks}>
            {launch.checks.map((check) => (
              <div key={check.id} data-state={check.status}>
                {check.status === "satisfied" ? (
                  <Check size={11} />
                ) : check.status === "blocked" ? (
                  <X size={11} />
                ) : (
                  <Loader2 size={11} className={styles.spin} />
                )}
                <span>
                  <b>{check.label}</b>
                  <small>{check.detail}</small>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.launchTelemetry}>
          <div>
            <span>Run</span>
            <code>{launch?.runId || "allocating"}</code>
          </div>
          <div>
            <span>Launch time</span>
            <b>
              {Math.floor(launchSeconds / 60)
                .toString()
                .padStart(2, "0")}
              :{(launchSeconds % 60).toString().padStart(2, "0")}
              {launchBudget > 0 ? ` / ${Math.floor(launchBudget / 60)}m` : ""}
            </b>
          </div>
          <div>
            <span>Match clock</span>
            <b>00:00 · paused</b>
          </div>
        </div>

        <footer className={styles.launchFooter}>
          <p className={error || failed ? styles.launchError : ""}>
            {error ??
              (failed ? launch?.failureReason : launch?.detail) ??
              "Opening the launch…"}
          </p>
          <div>
            {(failed || error) && (
              <button type="button" onClick={onRetry} disabled={busy}>
                {failed ? "Retry launch" : "Retry check"}
              </button>
            )}
            <button
              type="button"
              className={styles.launchCancel}
              onClick={onCancel}
              disabled={!launch || launch.active}
            >
              <X size={12} /> Cancel setup
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
