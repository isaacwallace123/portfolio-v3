"use client";

import { useState } from "react";
import { Gauge, Layers, Loader2, SlidersHorizontal } from "lucide-react";
import { liveDecision } from "@/shared/api/live-client";
import { DrillPanel, useDrillState } from "@/features/drill";
import { SCALABLE, type ServiceId } from "./model/topology";
import { useClusterEdges } from "./model/useClusterEdges";
import { useClusterRun } from "./model/useClusterRun";
import { ActivityPanel } from "./ui/ActivityPanel";
import { Celebration } from "./ui/Celebration";
import { ClusterGraph } from "./ui/ClusterGraph";
import { ClusterHud } from "./ui/ClusterHud";
import { ControlsPanel } from "./ui/ControlsPanel";
import { InspectorPanel } from "./ui/InspectorPanel";
import { LaunchScreen } from "./ui/LaunchScreen";
import { RenewalModal } from "./ui/RenewalModal";
import styles from "./workbench.module.css";

type Tab = "drills" | "controls" | "activity";

const TABS: { id: Tab; icon: typeof Gauge; label: string }[] = [
  { id: "drills", icon: Gauge, label: "Drills" },
  { id: "controls", icon: SlidersHorizontal, label: "Controls" },
  { id: "activity", icon: Layers, label: "Activity" },
];

/** The last minute before expiry — early enough to act on, late enough to be a real decision. */
const RENEWAL_WINDOW_MS = 60_000;

/**
 * The practice cluster surface: a canvas showing the live request path, and a panel for drills,
 * controls and activity. Everything about fetching and mutating the cluster lives in
 * `useClusterRun`; everything about drawing it lives in `ui/`. This file is the wiring between them.
 */
export default function ClusterWorkbench() {
  const {
    status,
    platform,
    run,
    components,
    events,
    trace,
    history,
    busy,
    error,
    expired,
    stale,
    now,
    setError,
    act,
    provision,
    renew,
    teardown,
  } = useClusterRun();

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drills");
  // Recorded per cluster: declining the offer on one must not silently suppress it on the next.
  const [renewalDeclinedFor, setRenewalDeclinedFor] = useState<string | null>(
    null,
  );

  // The drill's own state machine. Lifted to here rather than owned by the panel because the
  // cluster graph needs the impact of a decision too — showing damage only in a side panel is what
  // made a wrong answer easy to click past.
  const drill = useDrillState(run, act, liveDecision);

  // Which cards exist, as a value rather than as an array identity. The poll hands back a fresh
  // components array every 1.2s even when nothing changed, and passing that in re-ran the layout
  // effect on every frame — a forced getBoundingClientRect over every card, several times a second,
  // for a graph that had not moved. Edges only need re-measuring when a card appears or disappears.
  const cardSignature = components
    .map((c) => `${c.name}:${c.pods.map((p) => p.name).join("|")}`)
    .join(",");

  // Re-measured whenever the set of cards changes, which is what moves the edges.
  const { canvasRef, cardRefs, paths } = useClusterEdges([
    cardSignature,
    run?.runId,
    run?.telemetry.apiReplicas,
    run?.loadGenerators,
    // The gateway and canary are scalable tiers now, so their replica counts move cards too.
    run?.gatewayReplicas,
    run?.canaryReplicas,
  ]);

  // ── first paint: still resolving the session ──────────────────────────────
  if (status === null) {
    return (
      <div className={styles.shell}>
        <div className={styles.booting}>
          <Loader2 size={18} className={styles.spin} />
          <span>Looking for your cluster…</span>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <LaunchScreen
        status={status}
        platform={platform}
        busy={busy}
        error={error}
        expired={expired}
        onProvision={provision}
      />
    );
  }

  const byName = (n: string) => components.find((c) => c.name === n);
  const provisioning = run.status === "provisioning";
  // Controls and Activity shrink to icons while a drill is live, so the drill gets the column.
  const drillRunning = run.drillId.length > 0;
  const flowing = run.loadEnabled && run.telemetry.requestsPerSec > 0;

  // What the operator has asked for. Known the instant a control is used, whereas the Deployment's
  // own desired count only catches up a round-trip later — so the graph can draw a card per intended
  // replica immediately and mark the ones that do not exist yet.
  const intendedPods = (svc: ServiceId): number => {
    switch (svc) {
      case "checkout":
        return run.telemetry.apiReplicas;
      case "k6":
        return run.loadGenerators;
      case "redis":
        return run.telemetry.cacheActive ? 1 : 0;
      case "envoy":
        return run.gatewayReplicas;
      case "checkout-canary":
        return run.canaryReplicas;
      default:
        return 1;
    }
  };

  // A replica the cluster has refused outright. Without this a pending card spins forever and reads
  // as slowness, when the cluster has already answered and the answer was no.
  const blockedReason = (svc: ServiceId): string | null => {
    const hit = events.find(
      (e) =>
        (e.reason === "FailedCreate" || e.reason === "FailedScheduling") &&
        e.message.includes(svc),
    );
    if (!hit) return null;
    return hit.message.includes("exceeded quota")
      ? "quota reached"
      : "cannot schedule";
  };

  // The one tier not yet where it was asked to be, so a change is narrated from the click through
  // to the last replica going ready.
  const converging = SCALABLE.map((svc) => ({
    svc,
    want: intendedPods(svc),
    have: byName(svc)?.pods.filter((p) => p.ready).length ?? 0,
  })).find((x) => x.want !== x.have);

  const createdMs = run.createdAt ? Date.parse(run.createdAt) : now;
  const remainingMs = Math.max(0, run.ttlMs - (now - createdMs));
  const offerRenewal =
    remainingMs > 0 &&
    remainingMs <= RENEWAL_WINDOW_MS &&
    run.renewable &&
    renewalDeclinedFor !== run.runId;

  return (
    <div className={styles.shell}>
      {/* Confetti is for a clean resolution. Firing it after a misstep congratulates the misstep. */}
      {run.drillSolved && run.drillWrongChosen === 0 && <Celebration />}

      {offerRenewal && (
        <RenewalModal
          remainingMs={remainingMs}
          busy={busy}
          onRenew={() => {
            setRenewalDeclinedFor(run.runId);
            renew();
          }}
          onDismiss={() => setRenewalDeclinedFor(run.runId)}
        />
      )}

      <div className={styles.body}>
        <div className={styles.canvas} ref={canvasRef}>
          <ClusterHud
            run={run}
            components={components}
            trace={trace}
            drillTitle={run.drillId ? run.drillTitle : null}
            provisioning={provisioning}
            flowing={flowing}
            stale={stale}
            busy={busy}
            error={error}
            remainingMs={remainingMs}
            converging={converging}
            onTeardown={teardown}
            onDismissError={() => setError(null)}
          />

          <ClusterGraph
            components={components}
            paths={paths}
            flowing={flowing}
            selected={selected}
            onSelect={setSelected}
            cardRefs={cardRefs}
            intendedPods={intendedPods}
            blockedReason={blockedReason}
            impactTiers={drill.impact
              .filter((i) => i.degrading)
              .map((i) => i.tier)}
          />
        </div>

        <aside className={styles.inspector}>
          {selected ? (
            <InspectorPanel
              selection={selected}
              components={components}
              history={history}
              trace={trace}
              onSelect={setSelected}
            />
          ) : (
            <div className={styles.panel}>
              {/* While a drill is running it owns this column. A drill is the primary activity, not
                  one of three equal tabs — sharing billing with a slider panel is part of why the
                  objective, the handoff and the misstep report all fought for the same space. */}
              <div className={styles.tabs}>
                {TABS.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    className={tab === id ? styles.tabOn : ""}
                    onClick={() => setTab(id)}
                    title={label}
                  >
                    <Icon size={13} />
                    {drillRunning && id !== "drills" ? "" : label}
                  </button>
                ))}
              </div>

              {tab === "drills" && (
                <DrillPanel
                  run={run}
                  busy={busy}
                  provisioning={provisioning}
                  act={act}
                  state={drill}
                />
              )}
              {tab === "controls" && (
                <ControlsPanel run={run} busy={busy} act={act} />
              )}
              {tab === "activity" && (
                <ActivityPanel events={events} provisioning={provisioning} />
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
