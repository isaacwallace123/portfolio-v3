import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkProblems } from "../model/checks";
import {
  courseUnits,
  drillTitle,
  DRILL_TITLES,
  segmentChecks,
  segmentDrillIds,
  type LearningBlock,
} from "../model/course";
import { ACADEMY_COURSE } from "./production-operations";

const course = ACADEMY_COURSE;

// Every drill the curriculum can point at. Read from the API's own catalog rather than typed out
// here, so a drill renamed in ScenarioDefinitions.cs fails this test instead of failing silently as
// a capstone nobody can launch.
const SCENARIOS = path.resolve(
  import.meta.dirname,
  "../../../../../api/Runs/ScenarioDefinitions.cs",
);

function knownDrillIds(): Set<string> {
  const source = readFileSync(SCENARIOS, "utf8");
  return new Set(
    [...source.matchAll(/Drill\("([a-z0-9-]+)"/g)].map((m) => m[1]),
  );
}

const blocks = (): LearningBlock[] =>
  course.segments.flatMap((s) => s.lessons.flatMap((l) => l.blocks));

describe("course structure", () => {
  it("has seven segments in order", () => {
    expect(course.segments).toHaveLength(7);
    expect(course.segments.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("gives every unit a unique id", () => {
    const ids = courseUnits(course).map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every lesson a unique id across the whole course", () => {
    const ids = course.segments.flatMap((s) => s.lessons.map((l) => l.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names only segments that exist as prerequisites", () => {
    const ids = new Set(course.segments.map((s) => s.id));
    for (const segment of course.segments)
      for (const prerequisite of segment.prerequisites)
        expect(ids, `${segment.id} requires ${prerequisite}`).toContain(
          prerequisite,
        );
  });

  it("has no segment requiring itself, directly or as its own successor", () => {
    for (const segment of course.segments)
      for (const prerequisite of segment.prerequisites) {
        expect(prerequisite).not.toBe(segment.id);
        const required = course.segments.find((s) => s.id === prerequisite)!;
        // A prerequisite must come earlier in the course, or the path is unwalkable.
        expect(required.order).toBeLessThan(segment.order);
      }
  });

  it("gives every segment lessons, a capstone and at least one knowledge check", () => {
    for (const segment of course.segments) {
      expect(segment.lessons.length, segment.id).toBeGreaterThanOrEqual(3);
      expect(segment.capstoneDrillId, segment.id).not.toBe("");
      expect(segmentChecks(segment).length, segment.id).toBeGreaterThanOrEqual(
        1,
      );
      expect(segment.outcomes.length, segment.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("lesson blocks", () => {
  it("opens every lesson with context and closes it with a summary", () => {
    for (const segment of course.segments)
      for (const lesson of segment.lessons) {
        expect(lesson.blocks[0]?.kind, lesson.id).toBe("context");
        expect(lesson.blocks[lesson.blocks.length - 1]?.kind, lesson.id).toBe(
          "summary",
        );
      }
  });

  it("gives every explanation an idea, an example and a signal to watch for", () => {
    for (const block of blocks())
      if (block.kind === "explanation") {
        expect(block.idea.length, block.title).toBeGreaterThan(20);
        expect(block.example.length, block.title).toBeGreaterThan(20);
        expect(block.watchFor.length, block.title).toBeGreaterThan(20);
      }
  });

  it("gives every prediction an outcome that is one of its own options", () => {
    for (const block of blocks())
      if (block.kind === "prediction") {
        const ids = block.prediction.options.map((o) => o.id);
        expect(ids, block.prediction.id).toContain(
          block.prediction.actualOptionId,
        );
        expect(block.prediction.because.length).toBeGreaterThan(40);
      }
  });

  it("uses a unique id for every prediction and knowledge check", () => {
    const ids = blocks().flatMap((b) =>
      b.kind === "check"
        ? [b.check.id]
        : b.kind === "prediction"
          ? [b.prediction.id]
          : [],
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("knowledge checks", () => {
  it("has exactly one correct option and an explanation for every option", () => {
    // A check with no correct option, or several, is not a hard question — it is a bug that reads
    // like one. This is the rule the compiler cannot express, so it is asserted here.
    for (const segment of course.segments)
      for (const check of segmentChecks(segment))
        expect(checkProblems(check), `${segment.id}/${check.id}`).toEqual([]);
  });

  it("explains the wrong options too, at length", () => {
    for (const segment of course.segments)
      for (const check of segmentChecks(segment))
        for (const option of check.options)
          expect(option.why.length, `${check.id}/${option.id}`).toBeGreaterThan(
            40,
          );
  });
});

describe("drills the curriculum points at", () => {
  const known = knownDrillIds();

  it("reads a non-empty catalog from the API", () => {
    expect(known.size).toBeGreaterThan(10);
  });

  it("only names capstones and supporting drills that exist", () => {
    for (const segment of course.segments)
      for (const drillId of segmentDrillIds(segment))
        expect(known, `${segment.id} → ${drillId}`).toContain(drillId);
  });

  it("names a final assessment drill that exists", () => {
    expect(known).toContain(course.finalAssessmentDrillId);
  });

  it("gives every segment a distinct capstone", () => {
    const capstones = course.segments.map((s) => s.capstoneDrillId);
    expect(new Set(capstones).size).toBe(capstones.length);
  });

  it("has a human title for every drill it names, matching the API catalog", () => {
    // Learner-facing text must never show a slug. The titles are mirrored into the Academy so a
    // lesson can render before anyone has provisioned a cluster, and this keeps the mirror honest.
    const source = readFileSync(SCENARIOS, "utf8");
    const titles = new Map(
      [...source.matchAll(/Drill\("([a-z0-9-]+)", "([^"]+)"/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );

    const named = [
      ...course.segments.flatMap(segmentDrillIds),
      course.finalAssessmentDrillId,
    ];
    for (const drillId of new Set(named)) {
      expect(DRILL_TITLES, drillId).toHaveProperty(drillId);
      expect(DRILL_TITLES[drillId], drillId).toBe(titles.get(drillId));
      // A prose title, not the id and not the id with its dashes taken out.
      expect(drillTitle(drillId)).not.toBe(drillId);
      expect(drillTitle(drillId)).not.toBe(drillId.replaceAll("-", " "));
      expect(drillTitle(drillId)).toMatch(/[A-Z]/);
    }
  });

  it("only points lesson summaries at drills that exist", () => {
    for (const block of blocks())
      if (block.kind === "summary" && block.drillId)
        expect(known, block.drillId).toContain(block.drillId);
  });
});

describe("the server's course manifest", () => {
  // The API is the authority on completion, so it holds its own list of unit ids. That duplication
  // is deliberate — a certificate cannot be gated on requirements the browser supplies — but it is
  // exactly the kind of duplication that rots, so it is checked.
  const MANIFEST = path.resolve(
    import.meta.dirname,
    "../../../../../api/Learning/CourseManifest.cs",
  );
  const source = readFileSync(MANIFEST, "utf8");

  it("agrees on the course id and version", () => {
    expect(source).toContain(`"${course.id}"`);
    expect(source).toMatch(
      new RegExp(`ProductionOperationsId,\\s*\\n\\s*${course.version},`),
    );
  });

  it("lists every segment id", () => {
    for (const segment of course.segments)
      expect(source, segment.id).toContain(`"${segment.id}"`);
  });

  it("lists every lesson id", () => {
    for (const segment of course.segments)
      for (const lesson of segment.lessons)
        expect(source, lesson.id).toContain(`"${lesson.id}"`);
  });

  it("lists every capstone drill id", () => {
    for (const segment of course.segments)
      expect(source, segment.capstoneDrillId).toContain(
        `"${segment.capstoneDrillId}"`,
      );
  });

  it("agrees on the final assessment unit id", () => {
    expect(source).toContain(`"assessment:${course.finalAssessmentDrillId}"`);
  });

  it("lists no lesson the course does not have", () => {
    const declared = [...source.matchAll(/^\s+"([a-z0-9-]+)",?$/gm)].map(
      (m) => m[1],
    );
    const known = new Set([
      ...course.segments.flatMap((s) => s.lessons.map((l) => l.id)),
      ...course.segments.map((s) => s.id),
      ...course.segments.map((s) => s.capstoneDrillId),
    ]);
    for (const id of declared)
      expect(known, `manifest names unknown id ${id}`).toContain(id);
  });
});
