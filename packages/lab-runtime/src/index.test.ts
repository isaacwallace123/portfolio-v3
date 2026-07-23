import { describe, expect, it } from "vitest";
import { formatRunClock, getRunSnapshot, type LabScenario } from ".";

const scenario: LabScenario = {
  id: "test",
  lab: "homelab",
  title: "Test",
  eyebrow: "Test",
  summary: "Test scenario",
  durationMs: 10_000,
  difficulty: "guided",
  resourceClass: "light",
  decisions: [],
  events: [
    {
      id: "start",
      offsetMs: 0,
      phase: "Provisioning",
      source: "controller",
      title: "Started",
      detail: "Run started",
      severity: "info",
    },
    {
      id: "ready",
      offsetMs: 5_000,
      phase: "Running",
      source: "runtime",
      title: "Ready",
      detail: "Workload ready",
      severity: "success",
    },
  ],
};

describe("getRunSnapshot", () => {
  it("reveals events as the run advances", () => {
    const snapshot = getRunSnapshot(scenario, 6_000);
    expect(snapshot.visibleEvents).toHaveLength(2);
    expect(snapshot.phase).toBe("Running");
    expect(snapshot.progress).toBe(0.6);
  });

  it("clamps elapsed time to the scenario duration", () => {
    const snapshot = getRunSnapshot(scenario, 15_000);
    expect(snapshot.elapsedMs).toBe(10_000);
    expect(snapshot.complete).toBe(true);
  });
});

describe("formatRunClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatRunClock(65_000)).toBe("01:05");
  });
});
