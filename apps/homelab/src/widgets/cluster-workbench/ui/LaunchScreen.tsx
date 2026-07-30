"use client";

import {
  Activity,
  Loader2,
  Lock,
  Play,
  Radio,
  Server,
  Timer,
} from "lucide-react";
import { AUTH_URL, HOMELAB_URL } from "@iw/core";
import type { LivePlatformStatus, LiveStatus } from "@/shared/api/live-client";
import styles from "../workbench.module.css";

/** Shown when the visitor has no cluster: what one is, and the single button that makes it. */
export function LaunchScreen({
  status,
  platform,
  busy,
  error,
  expired,
  surface,
  onProvision,
}: {
  status: LiveStatus;
  platform: LivePlatformStatus | null;
  busy: string | null;
  error: string | null;
  /** The previous cluster hit its time limit — say so rather than silently offering another. */
  expired: boolean;
  surface: "practice" | "ranked";
  onProvision: () => void;
}) {
  const ranked = surface === "ranked";
  const slots = platform?.slotsAvailable ?? null;
  const signInUrl = `${AUTH_URL}/login?returnUrl=${encodeURIComponent(
    `${HOMELAB_URL}/${surface}`,
  )}`;

  const label = () => {
    if (busy === "provision") return "Provisioning…";
    if (!status.enabled) return "Live control offline";
    if (slots === 0) return "All cluster slots busy";
    return ranked ? "Prepare ranked arena" : "Provision cluster";
  };

  return (
    <div className={styles.shell} data-surface={surface}>
      <div className={styles.empty}>
        <p className={styles.kicker}>
          <Radio size={14} />{" "}
          {ranked ? "Real cluster competition" : "Real cluster control"}
        </p>
        <h1>
          {ranked
            ? "Your next incident runs for real."
            : "Build a cluster. Then break it."}
        </h1>
        <p className={styles.lede}>
          {ranked
            ? "Prepare an isolated Kubernetes arena on the live homelab. The control plane draws a multi-stage incident and applies every allowlisted operator command to the running workload. Measured recovery moves your seasonless ELO; verified recoveries also record an official time."
            : "Provision a disposable Kubernetes workspace on the live homelab — an isolated namespace running a checkout API, Postgres, Redis, an Envoy gateway and a k6 load generator. Operate it freely, or run a practice drill and work a real incident."}
        </p>
        <ul className={styles.included}>
          <li>
            <Server size={15} /> Isolated namespace, quota and default-deny
            network policy
          </li>
          <li>
            <Activity size={15} /> Every metric measured from the running
            workload
          </li>
          <li>
            <Lock size={15} /> Private to your account — one{" "}
            {ranked ? "arena" : "cluster"} at a time
          </li>
          <li>
            <Timer size={15} />{" "}
            {ranked
              ? "Operate through an audited command console; measured outcomes decide the match"
              : "Self-destructs after 15 minutes, extendable once"}
          </li>
        </ul>

        {expired && (
          <p className={styles.expiredNote}>
            <Timer size={14} /> Your last cluster reached its time limit and was
            destroyed. Prepare another to pick up where you left off.
          </p>
        )}

        {status.signedIn ? (
          <button
            className={styles.primary}
            onClick={onProvision}
            disabled={!status.enabled || busy !== null || slots === 0}
          >
            {busy === "provision" ? (
              <Loader2 size={16} className={styles.spin} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            {label()}
          </button>
        ) : (
          <a className={styles.primary} href={signInUrl}>
            <Lock size={16} /> Sign in to{" "}
            {ranked ? "enter ranked" : "provision"}
          </a>
        )}

        {platform && (
          <p className={styles.capacity}>
            {platform.nodesReady}/{platform.nodesTotal} nodes ready ·{" "}
            {platform.slotsAvailable}/{platform.maxConcurrentRuns} cluster slots
            free
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
