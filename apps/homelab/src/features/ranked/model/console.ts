import type {
  ClusterEvent,
  LiveRunView,
  LiveTrace,
  RunComponent,
} from "@/shared/api/live-client";

export type LocalCommand =
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "history" }
  | { kind: "metrics"; service: string | null }
  | { kind: "events"; warningsOnly: boolean }
  | { kind: "pods"; service: string | null }
  | { kind: "trace" }
  | { kind: "remote"; command: string };

const SERVICE_ALIASES: Record<string, string> = {
  gateway: "envoy",
  cache: "redis",
  canary: "checkout-canary",
};

export const COMMAND_HELP = [
  "inspect metrics [checkout|gateway|cache]",
  "inspect events [--warnings]",
  "inspect pods [service]",
  "trace latest",
  "history",
  "scale checkout <1-6>",
  "scale gateway <1-3>",
  "shift canary <0-3>",
  "enable cache | disable cache",
  "rollback checkout",
  "recover catalogue",
  "drain apps | drain infra",
  "restart checkout",
] as const;

export function parseConsoleCommand(input: string): LocalCommand {
  const command = input.trim().toLowerCase().replace(/\s+/g, " ");
  const words = command.split(" ");

  if (!command || command === "help") return { kind: "help" };
  if (command === "clear") return { kind: "clear" };
  if (command === "history") return { kind: "history" };
  if (command === "trace latest") return { kind: "trace" };
  if (words[0] === "inspect" && words[1] === "metrics")
    return { kind: "metrics", service: words[2] ?? null };
  if (words[0] === "inspect" && words[1] === "events")
    return { kind: "events", warningsOnly: words[2] === "--warnings" };
  if (words[0] === "inspect" && words[1] === "pods")
    return { kind: "pods", service: words[2] ?? null };
  return { kind: "remote", command };
}

function serviceNamed(
  components: RunComponent[],
  requested: string | null,
): RunComponent | null {
  if (!requested) return null;
  const name = SERVICE_ALIASES[requested] ?? requested;
  return components.find((component) => component.name === name) ?? null;
}

export function metricsOutput(
  run: LiveRunView,
  components: RunComponent[],
  service: string | null,
): string[] {
  if (service) {
    const component = serviceNamed(components, service);
    if (!component) return [`No measured service matches "${service}".`];
    const limit =
      component.cpuLimitMillicoresPerPod > 0
        ? ` / ${component.cpuLimitMillicoresPerPod * Math.max(component.desired, 1)}m limit`
        : "";
    return [
      `${component.name}: ${component.ready}/${component.desired} ready`,
      `cpu ${component.cpuMillicores}m${limit} · memory ${component.memoryMiB}Mi`,
      `restarts ${component.pods.reduce((sum, pod) => sum + pod.restarts, 0)}`,
    ];
  }

  const t = run.telemetry;
  const visibility = run.rankedBriefing?.telemetry;
  const served =
    visibility?.throughput === false
      ? "served [withheld]"
      : `served ${t.requestsPerSec}/s`;
  const latency =
    visibility?.latency === false
      ? "p95 [withheld]"
      : `p95 ${Math.round(t.p95LatencyMs * 10) / 10}ms`;
  const errors =
    visibility?.errors === false
      ? "errors [withheld]"
      : `errors ${t.errorRatePct.toFixed(2)}%`;
  return [
    `${served} · offered ${run.offeredRequestsPerSec}/s`,
    `${latency} · objective is judged server-side`,
    `${errors} · live gauges follow match visibility`,
    `checkout ${t.apiReplicas} · gateway ${run.gatewayReplicas} · canary ${run.canaryReplicas}`,
  ];
}

export function eventsOutput(
  events: ClusterEvent[],
  warningsOnly: boolean,
): string[] {
  const visible = (
    warningsOnly
      ? events.filter((event) => event.severity === "warning")
      : events
  ).slice(-8);
  if (visible.length === 0)
    return [
      warningsOnly
        ? "No Kubernetes warnings in the current event window."
        : "No Kubernetes events are available yet.",
    ];
  return visible.map(
    (event) =>
      `${event.severity === "warning" ? "WARN" : "INFO"} ${event.reason} · ${event.message}`,
  );
}

export function podsOutput(
  components: RunComponent[],
  service: string | null,
): string[] {
  const selected = service ? serviceNamed(components, service) : null;
  if (service && !selected)
    return [`No measured service matches "${service}".`];
  const scope = selected ? [selected] : components;
  const lines = scope.flatMap((component) =>
    component.pods.map(
      (pod) =>
        `${component.name}/${pod.name} ${pod.ready ? "ready" : pod.detail || pod.phase} ` +
        `pool=${pod.pool || "pending"} cpu=${pod.cpuMillicores}m mem=${pod.memoryMiB}Mi`,
    ),
  );
  return lines.length > 0 ? lines : ["No pods are visible yet."];
}

export function traceOutput(trace: LiveTrace | null): string[] {
  if (!trace) return ["No distributed trace has been captured yet."];
  return [
    `trace ${trace.traceId.slice(0, 12)} · ${trace.durationMs}ms · release ${trace.release}`,
    ...trace.spans.map(
      (span) =>
        `${span.status === "error" ? "ERR " : "OK  "} ${span.service}/${span.name} ${span.durationMs}ms`,
    ),
  ];
}
