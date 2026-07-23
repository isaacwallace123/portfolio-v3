import type { TelemetryModel } from "./contract";

export type LabKind = "cyberlab" | "homelab" | "ailab";

export type RunStatus =
  | "idle"
  | "queued"
  | "provisioning"
  | "running"
  | "collecting"
  | "complete"
  | "failed";

export type EventSeverity = "info" | "success" | "warning" | "critical";

export interface RunEvent {
  id: string;
  offsetMs: number;
  phase: string;
  source: string;
  title: string;
  detail: string;
  severity: EventSeverity;
}

export interface ScenarioDecision {
  id: string;
  label: string;
  description: string;
  availableAfterMs: number;
}

export interface LabScenario {
  id: string;
  lab: LabKind;
  title: string;
  eyebrow: string;
  summary: string;
  durationMs: number;
  difficulty: "guided" | "operator" | "expert";
  resourceClass: "light" | "standard" | "heavy";
  events: RunEvent[];
  decisions: ScenarioDecision[];
  // Optional deterministic telemetry model consumed by the run engine's encoder. Scenarios without
  // one (e.g. ailab experiments) simply report a flat baseline projection.
  telemetry?: TelemetryModel;
}

export interface RunSnapshot {
  elapsedMs: number;
  progress: number;
  phase: string;
  visibleEvents: RunEvent[];
  currentEvent?: RunEvent;
  complete: boolean;
}

export function getRunSnapshot(
  scenario: LabScenario,
  elapsedMs: number,
): RunSnapshot {
  const boundedElapsed = Math.max(0, Math.min(elapsedMs, scenario.durationMs));
  const visibleEvents = scenario.events.filter(
    (event) => event.offsetMs <= boundedElapsed,
  );
  const currentEvent = visibleEvents.at(-1);

  return {
    elapsedMs: boundedElapsed,
    progress:
      scenario.durationMs === 0 ? 1 : boundedElapsed / scenario.durationMs,
    phase: currentEvent?.phase ?? "Ready",
    visibleEvents,
    currentEvent,
    complete: boundedElapsed >= scenario.durationMs,
  };
}

export function formatRunClock(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

// Public run-controller contract + reference engine.
export * from "./contract";
export * from "./engine";
