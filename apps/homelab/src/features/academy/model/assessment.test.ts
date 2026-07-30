import { describe, expect, it } from "vitest";
import { ACADEMY_COURSE } from "../content/production-operations";
import {
  assessmentUnitId,
  checkpointUnitId,
  drillUnitId,
  lessonUnitId,
  SKILL_LABELS,
  type LearningSegment,
} from "./course";
import {
  courseState,
  emptyProgress,
  type CourseProgress,
  type UnitProgress,
} from "./progress";
import { unlockedSegments } from "./unlocks";
import {
  ASSESSMENT_HREF,
  ASSESSMENT_RULES,
  assessmentBlueprint,
  assessmentDrillHref,
  assessmentSkills,
  assessmentStanding,
  BLUEPRINT_CAVEAT,
  certificateStanding,
  outstandingWork,
  standingAnnouncement,
} from "./assessment";

const course = ACADEMY_COURSE;

const done = (
  unitId: string,
  extra: Partial<UnitProgress> = {},
): UnitProgress => ({
  unitId,
  unitType: unitId.split(":")[0] as UnitProgress["unitType"],
  status: "completed",
  score: 100,
  attempts: 1,
  bestElapsedMs: null,
  clean: true,
  completedUtc: "2026-07-30T00:00:00Z",
  ...extra,
});

function progressWith(
  units: UnitProgress[],
  extra: Partial<CourseProgress> = {},
): CourseProgress {
  return {
    ...emptyProgress(course),
    accountBacked: true,
    units: Object.fromEntries(units.map((u) => [u.unitId, u])),
    ...extra,
  };
}

/** Lessons + checkpoint. */
function read(segment: LearningSegment): UnitProgress[] {
  return [
    ...segment.lessons.map((l) => done(lessonUnitId(l.id))),
    done(checkpointUnitId(segment.id)),
  ];
}

/** Everything a segment needs to count towards the assessment gate. */
function finish(segment: LearningSegment): UnitProgress[] {
  return [
    ...read(segment),
    done(drillUnitId(segment.id, segment.capstoneDrillId)),
  ];
}

const stateOf = (progress: CourseProgress) =>
  courseState(course, progress, unlockedSegments(course, progress));

const READY = progressWith(course.segments.flatMap(finish));
const standingFor = (progress: CourseProgress) =>
  assessmentStanding(course, progress, stateOf(progress));

describe("the assessment's own route", () => {
  it("is the dedicated overview, not the drill", () => {
    expect(ASSESSMENT_HREF).toBe("/practice/assessment");
    expect(ASSESSMENT_HREF).not.toContain("/drill/");
  });

  it("launches the real double-fault scenario through the existing practice path", () => {
    expect(course.finalAssessmentDrillId).toBe("double-fault");
    expect(assessmentDrillHref(course)).toBe(
      "/practice/drill/double-fault?assessment=1",
    );
  });
});

describe("the course-wide skill handoff", () => {
  it("carries all seven domain labels", () => {
    const skills = assessmentSkills(course);
    expect(skills).toHaveLength(7);
    expect(skills).toEqual([
      "Observability",
      "Capacity",
      "Releases",
      "Data",
      "Scheduling",
      "Gateways",
      "Progressive delivery",
    ]);
  });

  it("covers every domain the course defines, with no invented one", () => {
    const declared = new Set(
      course.segments.map((s) => SKILL_LABELS[s.domain]),
    );
    expect(new Set(assessmentSkills(course))).toEqual(declared);
  });
});

describe("the blueprint", () => {
  it("has a row per domain, each pointing back at the segment that teaches it", () => {
    const rows = assessmentBlueprint(course, stateOf(emptyProgress(course)));
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.label).toBe(SKILL_LABELS[row.domain]);
      expect(row.contributes.length).toBeGreaterThan(20);
      expect(course.segments.some((s) => s.id === row.segmentId)).toBe(true);
    }
  });

  it("reports a domain as demonstrated only once its own capstone is solved", () => {
    const nothing = assessmentBlueprint(course, stateOf(emptyProgress(course)));
    expect(nothing.every((r) => !r.demonstrated)).toBe(true);

    const everything = assessmentBlueprint(course, stateOf(READY));
    expect(everything.every((r) => r.demonstrated)).toBe(true);
  });

  it("reports no per-domain score, because none is measured", () => {
    // The backend judges one objective from cluster telemetry. It does not grade seven domains,
    // so a row may say "solved" or "pending" and nothing in between. The only number a row
    // carries is the segment's position in the course.
    const rows = assessmentBlueprint(course, stateOf(READY));
    expect(Object.keys(rows[0]).sort()).toEqual([
      "contributes",
      "demonstrated",
      "domain",
      "label",
      "segmentId",
      "segmentOrder",
      "segmentTitle",
    ]);
    for (const row of rows) {
      const numeric = Object.entries(row).filter(
        ([, v]) => typeof v === "number",
      );
      expect(numeric.map(([k]) => k)).toEqual(["segmentOrder"]);
    }
  });

  it("does not claim one scenario proves mastery of every domain", () => {
    expect(BLUEPRINT_CAVEAT).toMatch(/cannot independently prove/);
    expect(BLUEPRINT_CAVEAT).toMatch(/combine them under ambiguity/);
  });
});

describe("the stated rules", () => {
  it("says it is unranked, retryable and never touches ELO", () => {
    const all = ASSESSMENT_RULES.map((r) => `${r.label} ${r.detail}`).join(" ");
    expect(all).toMatch(/[Uu]nranked/);
    expect(all).toMatch(/retr/i);
    expect(all).toContain("ELO");
    expect(all).toMatch(/never touches ELO/);
  });

  it("says the cluster is real and the platform judges the measured outcome", () => {
    const all = ASSESSMENT_RULES.map((r) => `${r.label} ${r.detail}`).join(" ");
    expect(all).toMatch(
      /real (disposable )?(Kubernetes )?(cluster|namespace)/i,
    );
    expect(all).toMatch(/measured telemetry/);
    expect(all).toMatch(/applied to the cluster/);
  });

  it("says more than one fault is present and no segment is named", () => {
    const ids = ASSESSMENT_RULES.map((r) => r.id);
    expect(ids).toContain("multi-fault");
    expect(ids).toContain("unlabelled");
    expect(ids).toContain("explained-after");
  });

  it("promises no external endorsement or accreditation", () => {
    const all = ASSESSMENT_RULES.map((r) => `${r.label} ${r.detail}`).join(" ");
    expect(all).not.toMatch(/accredit|industry certification|CNCF|AWS/i);
  });
});

describe("locked versus unlocked", () => {
  it("is locked for a new learner, with nowhere to launch from", () => {
    const standing = standingFor(emptyProgress(course));
    expect(standing.stage).toBe("locked");
    expect(standing.unlocked).toBe(false);
    expect(standing.actionLabel).toBe("Locked");
    expect(standing.lockedBecause).not.toBe("");
  });

  it("names every outstanding segment, with a link into the work", () => {
    const outstanding = outstandingWork(course, emptyProgress(course));
    expect(outstanding).toHaveLength(course.segments.length);
    for (const item of outstanding) {
      expect(item.href).toContain(`/practice/segment/${item.segmentId}`);
      expect(item.missing.length).toBeGreaterThan(0);
    }
  });

  it("narrows the outstanding list as work is finished", () => {
    const allButLast = progressWith(
      course.segments.slice(0, -1).flatMap(finish),
    );
    const outstanding = outstandingWork(course, allButLast);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0].segmentId).toBe(
      course.segments[course.segments.length - 1].id,
    );
  });

  it("distinguishes an unread segment from one that only lacks its capstone", () => {
    const readOnly = progressWith(course.segments.flatMap(read));
    const outstanding = outstandingWork(course, readOnly);
    expect(outstanding).toHaveLength(course.segments.length);
    for (const item of outstanding) {
      expect(item.missing).toHaveLength(1);
      expect(item.missing[0]).toContain("capstone not solved");
    }
  });

  it("sends a learner who only owes a checkpoint straight to it", () => {
    const segment = course.segments[0];
    const lessonsOnly = progressWith(
      segment.lessons.map((l) => done(lessonUnitId(l.id))),
    );
    const row = outstandingWork(course, lessonsOnly).find(
      (o) => o.segmentId === segment.id,
    )!;
    expect(row.href).toBe(`/practice/segment/${segment.id}#checkpoint`);
    expect(row.missing).toContain("checkpoint not taken");
  });

  it("opens on a first attempt once every segment is genuinely complete", () => {
    const standing = standingFor(READY);
    expect(standing.unlocked).toBe(true);
    expect(standing.stage).toBe("first-attempt");
    expect(standing.started).toBe(false);
    expect(standing.completed).toBe(false);
    expect(standing.actionLabel).toBe("Begin final assessment");
    expect(standing.outstanding).toEqual([]);
    expect(standing.lockedBecause).toBe("");
  });

  it("offers to resume an attempt that was opened and not finished", () => {
    const unitId = assessmentUnitId(course.finalAssessmentDrillId);
    const started = progressWith([
      ...course.segments.flatMap(finish),
      done(unitId, {
        status: "in-progress",
        attempts: 0,
        score: null,
        clean: false,
        completedUtc: null,
      }),
    ]);
    const standing = standingFor(started);
    expect(standing.stage).toBe("retry");
    expect(standing.started).toBe(true);
    expect(standing.completed).toBe(false);
    expect(standing.actionLabel).toBe("Resume the final assessment");
  });

  it("offers a retry, with the recorded attempt, once it is completed", () => {
    const unitId = assessmentUnitId(course.finalAssessmentDrillId);
    const finished = progressWith([
      ...course.segments.flatMap(finish),
      done(unitId, { attempts: 2, bestElapsedMs: 415_000, clean: true }),
    ]);
    const standing = standingFor(finished);
    expect(standing.stage).toBe("retry");
    expect(standing.completed).toBe(true);
    expect(standing.started).toBe(false);
    expect(standing.attempts).toBe(2);
    expect(standing.bestElapsedMs).toBe(415_000);
    expect(standing.clean).toBe(true);
    expect(standing.actionLabel).toBe("Run the assessment again");
  });
});

describe("what is read out when the standing resolves", () => {
  it("says why it is locked", () => {
    const announcement = standingAnnouncement(
      standingFor(emptyProgress(course)),
    );
    expect(announcement).toContain("locked");
    expect(announcement.length).toBeGreaterThan(
      "Final assessment locked. ".length,
    );
  });

  it("says it is ready, then says what remains once it is done", () => {
    expect(standingAnnouncement(standingFor(READY))).toContain(
      "unlocked and ready",
    );

    const finished = progressWith([
      ...course.segments.flatMap(finish),
      done(assessmentUnitId(course.finalAssessmentDrillId)),
    ]);
    expect(standingAnnouncement(standingFor(finished))).toContain(
      "Every certificate requirement is met",
    );
  });
});

describe("certificate standing", () => {
  it("is honest about local-only progress, whatever else is complete", () => {
    const local = progressWith(
      [
        ...course.segments.flatMap(finish),
        done(assessmentUnitId(course.finalAssessmentDrillId)),
      ],
      { accountBacked: false },
    );
    const certificate = certificateStanding(course, local, stateOf(local));
    expect(certificate.accountBacked).toBe(false);
    expect(certificate.eligible).toBe(false);
    expect(certificate.remaining.map((r) => r.id)).toContain("account");
  });

  it("names the requirements still outstanding rather than saying 'not yet'", () => {
    const standing = standingFor(emptyProgress(course));
    expect(standing.certificate.eligible).toBe(false);
    expect(standing.certificate.remaining.length).toBeGreaterThan(1);
    for (const req of standing.certificate.remaining)
      expect(req.label.length).toBeGreaterThan(0);
  });

  it("still withholds eligibility when only the assessment is missing", () => {
    const standing = standingFor(READY);
    expect(standing.certificate.eligible).toBe(false);
    expect(standing.certificate.remaining.map((r) => r.id)).toEqual([
      "assessment",
    ]);
  });

  it("becomes eligible once the assessment is recorded too", () => {
    const finished = progressWith([
      ...course.segments.flatMap(finish),
      done(assessmentUnitId(course.finalAssessmentDrillId)),
    ]);
    const standing = standingFor(finished);
    expect(standing.completed).toBe(true);
    expect(standing.certificate.eligible).toBe(true);
    expect(standing.certificate.remaining).toEqual([]);
  });
});
