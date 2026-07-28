import type { ClusterEvent } from "@/shared/lib/liveClient";

// Classification for the activity log. Kubernetes only tells us Normal vs Warning, which collapses
// "pulled the image" and "scaled a replica set" into one grey blob. The reason string carries the real
// meaning, so it is mapped here into a severity and a lifecycle phase the log can colour and filter by.

export type Level = "error" | "warn" | "success" | "info";
export type Phase =
  | "schedule"
  | "image"
  | "lifecycle"
  | "scaling"
  | "health"
  | "storage"
  | "other";

export const LEVELS: { id: Level; label: string }[] = [
  { id: "error", label: "Error" },
  { id: "warn", label: "Warning" },
  { id: "success", label: "Success" },
  { id: "info", label: "Info" },
];

export const PHASES: { id: Phase; label: string }[] = [
  { id: "schedule", label: "Scheduling" },
  { id: "image", label: "Image" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "scaling", label: "Scaling" },
  { id: "health", label: "Health" },
  { id: "storage", label: "Storage" },
  { id: "other", label: "Other" },
];

// Reasons that mean something went wrong, regardless of how Kubernetes typed them.
const ERROR_REASONS = new Set([
  "Failed",
  "FailedScheduling",
  "FailedCreate",
  "FailedCreatePodSandBox",
  "FailedMount",
  "FailedAttachVolume",
  "FailedKillPod",
  "BackOff",
  "CrashLoopBackOff",
  "ErrImagePull",
  "ImagePullBackOff",
  "Evicted",
  "OOMKilling",
  "NodeNotReady",
]);

const WARN_REASONS = new Set([
  "Unhealthy",
  "ProbeWarning",
  "Preempting",
  "Preempted",
  "NodeNotSchedulable",
  "FailedToUpdateEndpoint",
  "SandboxChanged",
]);

// Reasons that represent something completing successfully.
const SUCCESS_REASONS = new Set([
  "Started",
  "Created",
  "Pulled",
  "Scheduled",
  "SuccessfulCreate",
  "SuccessfulAttachVolume",
  "SuccessfulMountVolume",
  "ScalingReplicaSet",
]);

const PHASE_BY_REASON: Record<string, Phase> = {
  Scheduled: "schedule",
  FailedScheduling: "schedule",
  Preempted: "schedule",
  Preempting: "schedule",
  Pulling: "image",
  Pulled: "image",
  ErrImagePull: "image",
  ImagePullBackOff: "image",
  Created: "lifecycle",
  Started: "lifecycle",
  Killing: "lifecycle",
  BackOff: "lifecycle",
  CrashLoopBackOff: "lifecycle",
  ScalingReplicaSet: "scaling",
  SuccessfulCreate: "scaling",
  SuccessfulDelete: "scaling",
  FailedCreate: "scaling",
  Unhealthy: "health",
  ProbeWarning: "health",
  NodeNotReady: "health",
  Evicted: "health",
  OOMKilling: "health",
  FailedMount: "storage",
  FailedAttachVolume: "storage",
  SuccessfulAttachVolume: "storage",
  SuccessfulMountVolume: "storage",
};

export function levelOf(e: ClusterEvent): Level {
  if (ERROR_REASONS.has(e.reason)) return "error";
  if (WARN_REASONS.has(e.reason)) return "warn";
  // Anything Kubernetes itself flagged as a Warning but we do not recognise is still a warning.
  if (e.severity === "warning") return "warn";
  if (SUCCESS_REASONS.has(e.reason)) return "success";
  return "info";
}

export function phaseOf(e: ClusterEvent): Phase {
  return PHASE_BY_REASON[e.reason] ?? "other";
}

export interface ActivityFilters {
  levels: Set<Level>;
  phases: Set<Phase>;
  query: string;
}

/** Filter is additive: an empty set means "no restriction on this dimension". */
export function matches(e: ClusterEvent, f: ActivityFilters): boolean {
  if (f.levels.size > 0 && !f.levels.has(levelOf(e))) return false;
  if (f.phases.size > 0 && !f.phases.has(phaseOf(e))) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    if (
      !e.reason.toLowerCase().includes(q) &&
      !e.message.toLowerCase().includes(q) &&
      !e.objectKind.toLowerCase().includes(q)
    )
      return false;
  }
  return true;
}

export function countByLevel(events: ClusterEvent[]): Record<Level, number> {
  const counts: Record<Level, number> = {
    error: 0,
    warn: 0,
    success: 0,
    info: 0,
  };
  for (const e of events) counts[levelOf(e)] += 1;
  return counts;
}
