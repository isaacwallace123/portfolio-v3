"use client";

import type { RefObject } from "react";
import { AlertTriangle, Cpu, Loader2, MemoryStick } from "lucide-react";
import type { RunComponent, RunPod } from "@/shared/api/live-client";
import { COLUMNS, SERVICES, type ServiceId } from "../model/topology";
import type { EdgePath } from "../model/useClusterEdges";
import { sampled } from "../lib/format";
import styles from "../workbench.module.css";

interface GraphProps {
  components: RunComponent[];
  paths: EdgePath[];
  flowing: boolean;
  selected: string | null;
  onSelect: (key: string | null) => void;
  cardRefs: RefObject<Record<string, HTMLElement | null>>;
  /** Replicas the operator has asked for, which the cluster may not have created yet. */
  intendedPods: (svc: ServiceId) => number;
  /** Why a replica cannot be created, if the cluster has refused it outright. */
  blockedReason: (svc: ServiceId) => string | null;
  /** Tiers a drill decision has just moved. Marked so the damage is visible where it happened,
   *  rather than only described in a panel the operator may not be looking at. */
  impactTiers?: string[];
}

/** A replica that exists, with its own measured CPU against its own limit. */
function PodCard({
  svc,
  pod,
  limit,
  selected,
  solo,
  impacted,
  onSelect,
  register,
}: {
  svc: ServiceId;
  pod: RunPod;
  limit: number;
  selected: boolean;
  /** The only replica of its tier — name it by role rather than by pod suffix. */
  solo: boolean;
  impacted: boolean;
  onSelect: () => void;
  register: (el: HTMLElement | null) => void;
}) {
  const meta = SERVICES[svc];
  const Icon = meta.icon;
  const pct = limit > 0 ? Math.min(100, (pod.cpuMillicores / limit) * 100) : 0;

  return (
    <button
      ref={register}
      className={`${styles.card} ${!pod.ready ? styles.cardStarting : ""} ${
        selected ? styles.cardActive : ""
      } ${pct > 85 ? styles.cardHot : ""} ${impacted ? styles.cardImpact : ""}`}
      onClick={onSelect}
      title={`${svc}-${pod.name} · ${pod.phase}`}
    >
      <span className={styles.cardHead}>
        <span className={styles.cardIcon}>
          <Icon size={14} />
        </span>
        <span className={styles.cardTitle}>
          <b>{meta.label}</b>
          <small>{solo ? meta.role : `…${pod.name}`}</small>
        </span>
        {/* Which worker pool this replica actually landed on. Measured, not requested — during an
            evacuation the fleet genuinely shows pods on both pools until the last one moves, which
            is the thing the migration drills are about and was previously invisible. */}
        {pod.pool && (
          <span
            className={`${styles.poolChip} ${pod.pool === "infra" ? styles.poolInfra : ""}`}
            title={`Scheduled on the ${pod.pool} worker pool`}
          >
            {pod.pool}
          </span>
        )}
        {pod.ready ? (
          <span className={styles.readyDot} />
        ) : (
          <Loader2 size={12} className={styles.spin} />
        )}
      </span>

      <span className={styles.cardBar}>
        <i style={{ width: `${Math.max(3, pct)}%` }} />
      </span>

      <span className={styles.cardFoot}>
        {!pod.ready ? (
          // Say what it is doing, not just that it is not done.
          <span className={styles.phaseText}>{pod.detail || pod.phase}</span>
        ) : sampled(pod.memoryMiB) ? (
          <>
            <span>
              <Cpu size={10} /> {pod.cpuMillicores}m
            </span>
            <span>
              <MemoryStick size={10} /> {pod.memoryMiB}Mi
            </span>
            {pod.restarts > 0 && (
              <span className={styles.warnText}>×{pod.restarts}</span>
            )}
          </>
        ) : (
          <span className={styles.phaseText}>awaiting metrics…</span>
        )}
      </span>
    </button>
  );
}

/** A replica asked for but not yet created — or one the cluster has refused. */
function GhostCard({
  svc,
  blocked,
  register,
}: {
  svc: ServiceId;
  blocked: string | null;
  register: (el: HTMLElement | null) => void;
}) {
  const meta = SERVICES[svc];
  const Icon = meta.icon;

  return (
    <div
      ref={register}
      className={`${styles.card} ${styles.cardGhost} ${blocked ? styles.cardBlocked : ""}`}
      aria-hidden="true"
    >
      <span className={styles.cardHead}>
        <span className={styles.cardIcon}>
          <Icon size={14} />
        </span>
        <span className={styles.cardTitle}>
          <b>{meta.label}</b>
          <small>{blocked ? "refused" : "pending"}</small>
        </span>
        {blocked ? (
          <AlertTriangle size={12} />
        ) : (
          <Loader2 size={12} className={styles.spin} />
        )}
      </span>
      <span className={styles.cardBar}>
        {!blocked && <i className={styles.barPulse} />}
      </span>
      <span className={styles.cardFoot}>
        <span className={styles.phaseText}>{blocked ?? "requesting…"}</span>
      </span>
    </div>
  );
}

/** Nothing running and nothing asked for — holds the shape of the graph. */
function EmptyCard({
  svc,
  active,
  onSelect,
  register,
}: {
  svc: ServiceId;
  active: boolean;
  onSelect: () => void;
  register: (el: HTMLElement | null) => void;
}) {
  const meta = SERVICES[svc];
  const Icon = meta.icon;

  return (
    <button
      ref={register}
      className={`${styles.card} ${styles.cardOff} ${active ? styles.cardActive : ""}`}
      onClick={onSelect}
    >
      <span className={styles.cardHead}>
        <span className={styles.cardIcon}>
          <Icon size={14} />
        </span>
        <span className={styles.cardTitle}>
          <b>{meta.label}</b>
          <small>{meta.role}</small>
        </span>
      </span>
      <span className={styles.cardFoot}>not provisioned</span>
    </button>
  );
}

export function ClusterGraph({
  components,
  paths,
  flowing,
  selected,
  onSelect,
  cardRefs,
  intendedPods,
  blockedReason,
  impactTiers = [],
}: GraphProps) {
  const byName = (n: string) => components.find((c) => c.name === n);

  return (
    <>
      <svg className={styles.edges} aria-hidden="true">
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            className={`${styles.edge} ${flowing ? styles.edgeLive : ""}`}
          />
        ))}
      </svg>

      <div className={styles.graph}>
        {COLUMNS.map((column, ci) => (
          <div key={ci} className={styles.column}>
            {column.map((svc) => {
              const c = byName(svc);
              const pods = c?.pods ?? [];
              const ghosts = Math.max(0, intendedPods(svc) - pods.length);
              const hit = impactTiers.includes(svc);

              if (pods.length === 0 && ghosts === 0) {
                return (
                  <EmptyCard
                    key={svc}
                    svc={svc}
                    active={selected === svc}
                    onSelect={() => onSelect(selected === svc ? null : svc)}
                    register={(el) => {
                      cardRefs.current[`${svc}:placeholder`] = el;
                    }}
                  />
                );
              }

              return [
                ...pods.map((p) => {
                  const key = `${svc}:${p.name}`;
                  return (
                    <PodCard
                      key={key}
                      svc={svc}
                      pod={p}
                      limit={c?.cpuLimitMillicoresPerPod ?? 0}
                      selected={selected === key}
                      solo={pods.length === 1}
                      impacted={hit}
                      onSelect={() => onSelect(selected === key ? null : key)}
                      register={(el) => {
                        cardRefs.current[key] = el;
                      }}
                    />
                  );
                }),
                ...Array.from({ length: ghosts }, (_, i) => (
                  <GhostCard
                    key={`${svc}:ghost${i}`}
                    svc={svc}
                    blocked={blockedReason(svc)}
                    register={(el) => {
                      cardRefs.current[`${svc}:ghost${i}`] = el;
                    }}
                  />
                )),
              ];
            })}
          </div>
        ))}
      </div>
    </>
  );
}
