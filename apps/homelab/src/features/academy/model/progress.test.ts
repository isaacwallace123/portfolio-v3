import { describe, expect, it } from "vitest";
import { ACADEMY_COURSE } from "../content/production-operations";
import {
  assessmentUnitId,
  checkpointUnitId,
  courseUnits,
  drillUnitId,
  lessonUnitId,
} from "./course";
import {
  CHECK_SCORE_REQUIRED,
  CLEAN_CAPSTONES_REQUIRED,
  courseState,
  demonstratedSkills,
  eligibility,
  emptyProgress,
  segmentState,
  type CourseProgress,
  type UnitProgress,
} from "./progress";
import { unlockedSegments } from "./unlocks";

const course = ACADEMY_COURSE;

function unit(unitId: string, over: Partial<UnitProgress> = {}): UnitProgress {
  return {
    unitId,
    unitType: unitId.split(":")[0] as UnitProgress["unitType"],
    status: "completed",
    score: null,
    attempts: 1,
    bestElapsedMs: null,
    clean: false,
    completedUtc: "2026-07-30T00:00:00Z",
    ...over,
  };
}

function withUnits(
  units: UnitProgress[],
  over: Partial<CourseProgress> = {},
): CourseProgress {
  return {
    ...emptyProgress(course),
    accountBacked: true,
    units: Object.fromEntries(units.map((u) => [u.unitId, u])),
    ...over,
  };
}

/** A learner who has finished a segment's lessons and checkpoint, optionally its capstone. */
function segmentDone(
  segmentId: string,
  opts: { capstone?: boolean; clean?: boolean; score?: number } = {},
): UnitProgress[] {
  const segment = course.segments.find((s) => s.id === segmentId)!;
  const units = segment.lessons.map((l) => unit(lessonUnitId(l.id)));
  units.push(unit(checkpointUnitId(segment.id), { score: opts.score ?? 100 }));
  if (opts.capstone)
    units.push(
      unit(drillUnitId(segment.id, segment.capstoneDrillId), {
        clean: opts.clean ?? false,
        bestElapsedMs: 90_000,
      }),
    );
  return units;
}

function everything(
  opts: { clean?: number; score?: number; assessment?: boolean } = {},
): CourseProgress {
  const clean = opts.clean ?? course.segments.length;
  const units = course.segments.flatMap((s, i) =>
    segmentDone(s.id, {
      capstone: true,
      clean: i < clean,
      score: opts.score ?? 100,
    }),
  );
  if (opts.assessment !== false)
    units.push(unit(assessmentUnitId(course.finalAssessmentDrillId)));
  return withUnits(units);
}

describe("segment aggregation", () => {
  it("is available, not in-progress, before anything has been done", () => {
    const progress = emptyProgress(course);
    const state = segmentState(course, course.segments[0], progress, true);
    expect(state.status).toBe("available");
    expect(state.fraction).toBe(0);
    expect(state.next?.kind).toBe("lesson");
  });

  it("reports the capstone as outstanding once the reading is done", () => {
    const segment = course.segments[0];
    const progress = withUnits(segmentDone(segment.id));
    const state = segmentState(course, segment, progress, true);

    expect(state.status).toBe("drill-pending");
    expect(state.lessonsComplete).toBe(state.lessonsTotal);
    expect(state.checkpointComplete).toBe(true);
    expect(state.capstoneComplete).toBe(false);
    // Two of three parts: the reading and the reasoning, but not the cluster.
    expect(state.fraction).toBeCloseTo(2 / 3);
    expect(state.next).toEqual({
      kind: "drill",
      drillId: segment.capstoneDrillId,
      title: "Real-cluster capstone",
    });
  });

  it("is complete only once the capstone is solved", () => {
    const segment = course.segments[0];
    const progress = withUnits(segmentDone(segment.id, { capstone: true }));
    const state = segmentState(course, segment, progress, true);

    expect(state.status).toBe("complete");
    expect(state.fraction).toBe(1);
    expect(state.next).toBeNull();
  });

  it("is mastered when the optional harder drill is also solved", () => {
    const segment = course.segments.find((s) => s.masteryDrillId)!;
    const progress = withUnits([
      ...segmentDone(segment.id, { capstone: true }),
      unit(drillUnitId(segment.id, segment.masteryDrillId!)),
    ]);
    expect(segmentState(course, segment, progress, true).status).toBe(
      "mastered",
    );
  });

  it("reports locked regardless of what has been completed inside it", () => {
    const segment = course.segments[6];
    const progress = withUnits(segmentDone(segment.id, { capstone: true }));
    expect(segmentState(course, segment, progress, false).status).toBe(
      "locked",
    );
  });
});

describe("course aggregation", () => {
  it("counts every unit in the course", () => {
    const state = courseState(
      course,
      everything(),
      unlockedSegments(course, everything()),
    );
    expect(state.unitsTotal).toBe(courseUnits(course).length);
    expect(state.unitsComplete).toBe(state.unitsTotal);
    expect(state.segmentsComplete).toBe(course.segments.length);
  });

  it("averages only the checkpoints that were actually taken", () => {
    // One checkpoint at 50%, nothing else. An untaken checkpoint is not a zero — it is a thing
    // that has not happened, and averaging it in would make the number mean "how much have you
    // done" rather than "how well did you reason".
    const progress = withUnits([
      unit(checkpointUnitId(course.segments[0].id), { score: 50 }),
    ]);
    const state = courseState(
      course,
      progress,
      unlockedSegments(course, progress),
    );
    expect(state.checkScore).toBe(50);
  });

  it("has no score at all before any checkpoint is taken", () => {
    const progress = emptyProgress(course);
    const state = courseState(
      course,
      progress,
      unlockedSegments(course, progress),
    );
    expect(state.checkScore).toBeNull();
  });

  it("points 'continue' at the first unfinished thing", () => {
    const progress = withUnits(segmentDone(course.segments[0].id));
    const state = courseState(
      course,
      progress,
      unlockedSegments(course, progress),
    );
    expect(state.resume?.segmentId).toBe(course.segments[0].id);
    expect(state.resume?.href).toContain("/practice/drill/");
  });

  it("has nothing to resume once the whole course is done", () => {
    const progress = everything();
    const state = courseState(
      course,
      progress,
      unlockedSegments(course, progress),
    );
    expect(state.resume).toBeNull();
  });

  it("only marks a skill demonstrated when its capstone was solved", () => {
    const segment = course.segments[0];
    const reading = withUnits(segmentDone(segment.id));
    const readingState = courseState(
      course,
      reading,
      unlockedSegments(course, reading),
    );
    const skill = readingState.skills.find((s) => s.domain === segment.domain)!;

    expect(skill.demonstrated).toBe(false);
    // Reading everything without touching a cluster must not look like mastery.
    expect(skill.level).toBeLessThan(0.5);
    expect(demonstratedSkills(readingState)).not.toContain(skill.label);

    const solved = withUnits(segmentDone(segment.id, { capstone: true }));
    const solvedState = courseState(
      course,
      solved,
      unlockedSegments(course, solved),
    );
    expect(
      solvedState.skills.find((s) => s.domain === segment.domain)!.demonstrated,
    ).toBe(true);
  });
});

describe("certificate eligibility", () => {
  const check = (progress: CourseProgress) =>
    eligibility(
      course,
      progress,
      courseState(course, progress, unlockedSegments(course, progress)),
    );

  it("is granted when every requirement is met", () => {
    const result = check(everything());
    expect(result.eligible).toBe(true);
    expect(result.requirements.every((r) => r.met)).toBe(true);
  });

  it("is refused to a learner whose progress is only in this browser", () => {
    const progress = { ...everything(), accountBacked: false };
    const result = check(progress);
    expect(result.eligible).toBe(false);
    expect(result.requirements.find((r) => r.id === "account")!.met).toBe(
      false,
    );
  });

  it("is refused without the final assessment", () => {
    const result = check(everything({ assessment: false }));
    expect(result.eligible).toBe(false);
    expect(result.requirements.find((r) => r.id === "assessment")!.met).toBe(
      false,
    );
  });

  it(`is refused below ${CHECK_SCORE_REQUIRED}% across knowledge checks`, () => {
    const result = check(everything({ score: CHECK_SCORE_REQUIRED - 5 }));
    expect(result.eligible).toBe(false);
    expect(result.requirements.find((r) => r.id === "score")!.met).toBe(false);
  });

  it(`is refused below ${CLEAN_CAPSTONES_REQUIRED} clean capstones`, () => {
    const result = check(everything({ clean: CLEAN_CAPSTONES_REQUIRED - 1 }));
    expect(result.eligible).toBe(false);
    expect(result.requirements.find((r) => r.id === "clean")!.met).toBe(false);
  });

  it(`is granted at exactly ${CLEAN_CAPSTONES_REQUIRED} clean capstones`, () => {
    // Five of seven, not all seven: the requirement is that most were clean, and a course that
    // silently demanded perfection would be a different promise from the one on the page.
    expect(
      check(everything({ clean: CLEAN_CAPSTONES_REQUIRED })).eligible,
    ).toBe(true);
  });

  it("is refused when a capstone is missing even if everything else is done", () => {
    const progress = everything();
    const last = course.segments[course.segments.length - 1];
    delete progress.units[drillUnitId(last.id, last.capstoneDrillId)];
    const result = check(progress);
    expect(result.eligible).toBe(false);
    expect(result.requirements.find((r) => r.id === "capstones")!.met).toBe(
      false,
    );
  });

  it("names the skills a certificate would carry", () => {
    const progress = everything();
    const state = courseState(
      course,
      progress,
      unlockedSegments(course, progress),
    );
    expect(demonstratedSkills(state)).toHaveLength(course.segments.length);
  });
});
