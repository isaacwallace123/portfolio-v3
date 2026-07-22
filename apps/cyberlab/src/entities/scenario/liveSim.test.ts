import { describe, expect, it } from "vitest";
import { enqueue, getLiveState } from "./liveSim";
import { getCaseStudies } from "./scenarios";

describe("getLiveState", () => {
  it("is deterministic for a fixed clock", () => {
    const t = 1_750_000_000_000;
    const a = getLiveState(t);
    const b = getLiveState(t);
    expect(a.live.caseStudyId).toBe(b.live.caseStudyId);
    expect(a.live.elapsedSec).toBe(b.live.elapsedSec);
    expect(a.live.currentStep).toBe(b.live.currentStep);
  });

  it("always reports a session for a known case study, within bounds", () => {
    // sample many instants across a full hour — the range must never be "off air"
    const known = new Set(getCaseStudies().map((s) => s.id));
    for (let i = 0; i < 60; i++) {
      const state = getLiveState(1_750_000_000_000 + i * 60_000);
      expect(known.has(state.live.caseStudyId)).toBe(true);
      expect(state.live.elapsedSec).toBeGreaterThanOrEqual(0);
      expect(state.live.elapsedSec).toBeLessThanOrEqual(state.live.durationSec);
      expect(state.live.currentStep).toBeLessThan(state.live.totalSteps);
      expect(state.live.screen.lines.length).toBeGreaterThan(0);
      expect(state.streamMode).toBe("simulated");
    }
  });

  it("advances as the clock advances within a run", () => {
    // find an instant early in a run, then check a few seconds later
    const t0 = 1_750_000_000_000;
    const a = getLiveState(t0);
    const b = getLiveState(t0 + 2_000);
    if (a.live.caseStudyId === b.live.caseStudyId) {
      expect(b.live.elapsedSec).toBeGreaterThanOrEqual(a.live.elapsedSec);
    }
  });
});

describe("enqueue", () => {
  it("rejects unknown case studies", () => {
    expect(enqueue("does-not-exist")).toBeNull();
  });

  it("queues a known case study and exposes it in live state", () => {
    const id = getCaseStudies()[0].id;
    const item = enqueue(id, "vitest");
    expect(item).not.toBeNull();
    expect(item!.caseStudyId).toBe(id);
    const state = getLiveState();
    expect(state.queue.some((q) => q.id === item!.id)).toBe(true);
  });
});
