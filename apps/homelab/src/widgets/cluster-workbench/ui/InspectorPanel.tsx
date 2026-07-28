"use client";

import { Layers, X } from "lucide-react";
import type { LiveTrace, RunComponent, RunPod } from "@/shared/lib/liveClient";
import { SERVICES, type ServiceId } from "../model/topology";
import type { Series } from "../model/useClusterRun";
import { Spark } from "./Spark";
import styles from "../workbench.module.css";

/** The list of replicas in a tier, doubling as the picker between them. */
function Siblings({
  comp,
  svc,
  currentName,
  onSelect,
}: {
  comp: RunComponent;
  svc: ServiceId;
  currentName?: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={styles.siblings}>
      {comp.pods.map((p) => (
        <button
          key={p.name}
          className={p.name === currentName ? styles.siblingOn : ""}
          onClick={() => onSelect(`${svc}:${p.name}`)}
        >
          <span>…{p.name}</span>
          <span>{p.cpuMillicores}m</span>
        </button>
      ))}
    </div>
  );
}

/** The most recent sampled request through checkout, span by span. */
function TraceSpans({ trace }: { trace: LiveTrace }) {
  return (
    <>
      <p className={styles.panelLabel}>Latest trace</p>
      <div className={styles.trace}>
        {trace.spans.map((sp) => (
          <div key={sp.spanId} className={styles.span}>
            <span>{sp.name}</span>
            <div className={styles.spanBar}>
              <i
                className={sp.status === "error" ? styles.spanErr : ""}
                style={{
                  width: `${Math.max(
                    2,
                    Math.min(
                      100,
                      (sp.durationMs / Math.max(1, trace.durationMs)) * 100,
                    ),
                  )}%`,
                }}
              />
            </div>
            <b>{Math.round(sp.durationMs)}ms</b>
          </div>
        ))}
      </div>
    </>
  );
}

/** One replica: its own numbers, its own trend, and a way back out to the whole tier. */
function PodDetail({
  svc,
  pod,
  comp,
  history,
  trace,
  onSelect,
}: {
  svc: ServiceId;
  pod: RunPod;
  comp: RunComponent;
  history: Series;
  trace: LiveTrace | null;
  onSelect: (key: string | null) => void;
}) {
  const limit = comp.cpuLimitMillicoresPerPod;
  const series = history[`${svc}:${pod.name}`] ?? [];

  return (
    <>
      <div className={styles.kv}>
        <span>Status</span>
        <b className={pod.ready ? styles.okText : styles.warnText}>
          {pod.ready ? pod.phase : pod.detail || "Starting"}
        </b>
      </div>
      <div className={styles.kv}>
        <span>CPU</span>
        <b>
          {pod.cpuMillicores}m / {limit}m
        </b>
      </div>
      <div className={styles.kv}>
        <span>Saturation</span>
        <b>{limit ? Math.round((pod.cpuMillicores / limit) * 100) : 0}%</b>
      </div>
      <div className={styles.kv}>
        <span>Memory</span>
        <b>{pod.memoryMiB} MiB</b>
      </div>
      <div className={styles.kv}>
        <span>Restarts</span>
        <b className={pod.restarts ? styles.warnText : ""}>{pod.restarts}</b>
      </div>

      <p className={styles.panelLabel}>This replica</p>
      <Spark label="CPU" unit="m" series={series.map((h) => h.cpu)} />
      <Spark label="Memory" unit="Mi" series={series.map((h) => h.mem)} />

      {comp.pods.length > 1 && (
        <>
          <p className={styles.panelLabel}>
            Other replicas ({comp.pods.length})
          </p>
          <Siblings
            comp={comp}
            svc={svc}
            currentName={pod.name}
            onSelect={onSelect}
          />
        </>
      )}

      <button className={styles.ghost} onClick={() => onSelect(svc)}>
        <Layers size={12} /> View the whole service
      </button>

      {svc === "checkout" && trace?.spans.length ? (
        <TraceSpans trace={trace} />
      ) : null}
    </>
  );
}

/** A whole tier: its totals, its trend, and its replicas to drill into. */
function ServiceDetail({
  svc,
  comp,
  history,
  onSelect,
}: {
  svc: ServiceId;
  comp: RunComponent;
  history: Series;
  onSelect: (key: string) => void;
}) {
  return (
    <>
      <div className={styles.kv}>
        <span>Replicas</span>
        <b>
          {comp.ready}/{comp.desired}
        </b>
      </div>
      <div className={styles.kv}>
        <span>CPU</span>
        <b>{comp.cpuMillicores}m</b>
      </div>
      <div className={styles.kv}>
        <span>Memory</span>
        <b>{comp.memoryMiB} MiB</b>
      </div>

      <p className={styles.panelLabel}>Service total</p>
      <Spark
        label="CPU"
        unit="m"
        series={(history[comp.name] ?? []).map((h) => h.cpu)}
      />

      <p className={styles.panelLabel}>Replicas — pick one</p>
      <Siblings comp={comp} svc={svc} onSelect={onSelect} />
    </>
  );
}

/**
 * The right-hand panel when something on the canvas is selected. A selection is either a service
 * ("redis") or one of its pods ("checkout:hl4k9"), which is what lets the same panel show either a
 * whole tier or a single replica.
 */
export function InspectorPanel({
  selection,
  components,
  history,
  trace,
  onSelect,
}: {
  selection: string;
  components: RunComponent[];
  history: Series;
  trace: LiveTrace | null;
  onSelect: (key: string | null) => void;
}) {
  const [svc, podName] = selection.split(":") as [ServiceId, string?];
  const meta = SERVICES[svc];
  const comp = components.find((c) => c.name === svc);
  const pod = podName ? comp?.pods.find((p) => p.name === podName) : undefined;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <b>
          {meta.label}
          {pod && <span className={styles.podTag}>…{pod.name}</span>}
        </b>
        <button
          className={styles.iconBtn}
          onClick={() => onSelect(null)}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <p className={styles.panelSub}>
        {pod ? `one replica · ${meta.role}` : meta.role}
      </p>

      {pod && comp ? (
        <PodDetail
          svc={svc}
          pod={pod}
          comp={comp}
          history={history}
          trace={trace}
          onSelect={onSelect}
        />
      ) : comp && comp.desired > 0 ? (
        <ServiceDetail
          svc={svc}
          comp={comp}
          history={history}
          onSelect={onSelect}
        />
      ) : (
        <p className={styles.blank}>
          This service is not provisioned right now.
        </p>
      )}
    </div>
  );
}
