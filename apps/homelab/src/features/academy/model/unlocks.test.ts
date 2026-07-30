import { describe, expect, it } from "vitest";
import { ACADEMY_COURSE } from "../content/production-operations";
import {
  checkpointUnitId,
  drillUnitId,
  lessonUnitId,
  type LearningSegment,
} from "./course";
import {
  emptyProgress,
  type CourseProgress,
  type UnitProgress,
} from "./progress";
import {
  assessmentLockReason,
  assessmentUnlocked,
  capstoneUnlocked,
  lockReason,
  prerequisiteMet,
  unlockedSegments,
} from "./unlocks";

const course = ACADEMY_COURSE;

const done = (unitId: string): UnitProgress => ({
  unitId,
  unitType: unitId.split(":")[0] as UnitProgress["unitType"],
  status: "completed",
  score: 100,
  attempts: 1,
  bestElapsedMs: null,
  clean: true,
  completedUtc: "2026-07-30T00:00:00Z",
});

function progressWith(units: UnitProgress[]): CourseProgress {
  return {
    ...emptyProgress(course),
    accountBacked: true,
    units: Object.fromEntries(units.map((u) => [u.unitId, u])),
  };
}

/** Lessons + checkpoint, which is what a prerequisite actually requires. */
function read(segment: LearningSegment): UnitProgress[] {
  return [
    ...segment.lessons.map((l) => done(lessonUnitId(l.id))),
    done(checkpointUnitId(segment.id)),
  ];
}

const byId = (id: string) => course.segments.find((s) => s.id === id)!;

describe("segment unlocks", () => {
  it("opens only segment 1 to a new learner", () => {
    const open = unlockedSegments(course, emptyProgress(course));
    expect([...open]).toEqual(["read-the-system"]);
  });

  it("opens segments 2 to 6 once segment 1 is read", () => {
    const open = unlockedSegments(
      course,
      progressWith(read(byId("read-the-system"))),
    );
    expect(open.has("capacity-and-scaling")).toBe(true);
    expect(open.has("releases-and-rollouts")).toBe(true);
    expect(open.has("data-and-caching")).toBe(true);
    expect(open.has("scheduling-and-movement")).toBe(true);
    expect(open.has("gateways-and-flow")).toBe(true);
  });

  it("keeps progressive delivery closed until releases AND gateways are read", () => {
    const afterSegment1 = progressWith(read(byId("read-the-system")));
    expect(
      unlockedSegments(course, afterSegment1).has("progressive-delivery"),
    ).toBe(false);

    const releasesOnly = progressWith([
      ...read(byId("read-the-system")),
      ...read(byId("releases-and-rollouts")),
    ]);
    expect(
      unlockedSegments(course, releasesOnly).has("progressive-delivery"),
    ).toBe(false);

    const both = progressWith([
      ...read(byId("read-the-system")),
      ...read(byId("releases-and-rollouts")),
      ...read(byId("gateways-and-flow")),
    ]);
    expect(unlockedSegments(course, both).has("progressive-delivery")).toBe(
      true,
    );
  });

  it("does not require a capstone to open the next segment", () => {
    // Capstones need a real disposable cluster and the platform runs few at once. "All slots are
    // busy" must never be a reason someone cannot carry on reading.
    const progress = progressWith(read(byId("read-the-system")));
    expect(prerequisiteMet(byId("read-the-system"), progress)).toBe(true);
    expect(unlockedSegments(course, progress).size).toBeGreaterThan(1);
  });

  it("is not satisfied by lessons without the checkpoint", () => {
    const lessonsOnly = progressWith(
      byId("read-the-system").lessons.map((l) => done(lessonUnitId(l.id))),
    );
    expect(prerequisiteMet(byId("read-the-system"), lessonsOnly)).toBe(false);
    expect(unlockedSegments(course, lessonsOnly).size).toBe(1);
  });

  it("names the segments that would open a locked one", () => {
    const reason = lockReason(
      course,
      byId("progressive-delivery"),
      emptyProgress(course),
    );
    expect(reason.locked).toBe(true);
    expect(reason.because).toContain("Releases and rollouts");
    expect(reason.because).toContain("Gateways and request flow");
  });

  it("reports no lock for an open segment", () => {
    expect(
      lockReason(course, byId("read-the-system"), emptyProgress(course)).locked,
    ).toBe(false);
  });
});

describe("capstone unlocks", () => {
  it("stays closed until the segment's lessons are read", () => {
    const segment = byId("read-the-system");
    expect(capstoneUnlocked(segment, emptyProgress(course), true)).toBe(false);

    const lessonsRead = progressWith(
      segment.lessons.map((l) => done(lessonUnitId(l.id))),
    );
    expect(capstoneUnlocked(segment, lessonsRead, true)).toBe(true);
  });

  it("stays closed while the segment itself is locked", () => {
    const segment = byId("progressive-delivery");
    const lessonsRead = progressWith(
      segment.lessons.map((l) => done(lessonUnitId(l.id))),
    );
    expect(capstoneUnlocked(segment, lessonsRead, false)).toBe(false);
  });
});

describe("final assessment", () => {
  it("requires every segment's capstone, not just its reading", () => {
    const readEverything = progressWith(course.segments.flatMap(read));
    expect(assessmentUnlocked(course, readEverything)).toBe(false);
    expect(assessmentLockReason(course, readEverything)).not.toBe("");

    const full = progressWith([
      ...course.segments.flatMap(read),
      ...course.segments.map((s) => done(drillUnitId(s.id, s.capstoneDrillId))),
    ]);
    expect(assessmentUnlocked(course, full)).toBe(true);
    expect(assessmentLockReason(course, full)).toBe("");
  });

  it("names the one outstanding segment when only one remains", () => {
    const all = course.segments;
    const units = [
      ...all.flatMap(read),
      ...all
        .slice(0, -1)
        .map((s) => done(drillUnitId(s.id, s.capstoneDrillId))),
    ];
    const reason = assessmentLockReason(course, progressWith(units));
    expect(reason).toContain(all[all.length - 1].title);
  });
});
