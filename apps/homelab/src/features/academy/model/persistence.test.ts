import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACADEMY_COURSE } from "../content/production-operations";
import {
  completeUnit,
  fetchLearningProgress,
  issueCertificate,
  LearningError,
  startUnit,
  toCourseProgress,
  type LearningProgressDto,
} from "../api/learning-client";
import {
  assessmentUnitId,
  checkpointUnitId,
  drillUnitId,
  lessonUnitId,
} from "./course";
import {
  emptyProgress,
  type CourseProgress,
  type UnitProgress,
} from "./progress";
import { localProgress, syncableUnits } from "./useAcademyProgress";

// Where Academy progress actually lives.
//
// Everything a certificate rests on is a row the API wrote. The browser is allowed to say that a
// lesson was read and a checkpoint was scored; it is not allowed to say that a cluster was fixed,
// and it cannot mint a certificate at all. These tests are about that line — the wire projection,
// what the sign-in merge is permitted to push, and what the client does with each answer the API
// can give it.

const course = ACADEMY_COURSE;

const unit = (
  unitId: string,
  extra: Partial<UnitProgress> = {},
): UnitProgress => ({
  unitId,
  unitType: unitId.split(":")[0] as UnitProgress["unitType"],
  status: "completed",
  score: null,
  attempts: 1,
  bestElapsedMs: null,
  clean: false,
  completedUtc: "2026-07-30T00:00:00Z",
  ...extra,
});

const withUnits = (units: UnitProgress[]): CourseProgress => ({
  ...emptyProgress(course),
  units: Object.fromEntries(units.map((u) => [u.unitId, u])),
});

const LESSON = lessonUnitId("the-request-path");
const CHECKPOINT = checkpointUnitId("read-the-system");
const CAPSTONE = drillUnitId("read-the-system", "checkout-traffic-spike");
const ASSESSMENT = assessmentUnitId(course.finalAssessmentDrillId);

// ── The sign-in merge ───────────────────────────────────────────────────────

describe("what the sign-in merge may push", () => {
  it("pushes a lesson and a checkpoint the account has never seen", () => {
    const local = withUnits([unit(LESSON), unit(CHECKPOINT, { score: 90 })]);
    const pushed = syncableUnits(local, emptyProgress(course)).map(
      (u) => u.unitId,
    );
    expect(pushed).toEqual([LESSON, CHECKPOINT]);
  });

  it("never pushes a capstone or the final assessment", () => {
    // These are written by the run broker from measured cluster telemetry. The API answers 409 to
    // a client-reported completion for either, so offering one is a request that can only fail —
    // and a merge that believed it could promote a local capstone would be promoting a claim.
    const local = withUnits([
      unit(LESSON),
      unit(CAPSTONE, { clean: true, bestElapsedMs: 41_000 }),
      unit(ASSESSMENT),
    ]);
    const pushed = syncableUnits(local, emptyProgress(course)).map(
      (u) => u.unitId,
    );
    expect(pushed).toEqual([LESSON]);
    expect(pushed).not.toContain(CAPSTONE);
    expect(pushed).not.toContain(ASSESSMENT);
  });

  it("never overwrites a row the account already has", () => {
    const local = withUnits([unit(CHECKPOINT, { score: 100 })]);
    const remote = withUnits([unit(CHECKPOINT, { score: 62 })]);
    expect(syncableUnits(local, remote)).toEqual([]);
  });

  it("pushes nothing that was merely started", () => {
    const local = withUnits([
      unit(LESSON, { status: "in-progress", completedUtc: null }),
    ]);
    expect(syncableUnits(local, emptyProgress(course))).toEqual([]);
  });

  it("pushes a mastered unit, which is completed and then some", () => {
    const local = withUnits([unit(CHECKPOINT, { status: "mastered" })]);
    expect(syncableUnits(local, emptyProgress(course))).toHaveLength(1);
  });
});

// ── Local storage is a waiting room ─────────────────────────────────────────

describe("what browser storage is allowed to become", () => {
  it("never restores a certificate from the browser", () => {
    // A certificate the browser could mint for itself is an image, not a record.
    const forged = localProgress(course, {
      certificate: {
        certificateId: "hoc-ffffffffffffffffffffffffffffffff",
        courseId: course.id,
        courseVersion: course.version,
        learnerName: "someone else",
        issuedUtc: "2026-07-30T00:00:00Z",
        skills: ["Observability"],
      },
    });
    expect(forged.certificate).toBeNull();
  });

  it("never claims to be account-backed", () => {
    expect(localProgress(course, { accountBacked: true }).accountBacked).toBe(
      false,
    );
  });

  it("is pinned to the course and version it was read for", () => {
    const stray = localProgress(course, {
      courseId: "someone-elses-course",
      courseVersion: 99,
    });
    expect(stray.courseId).toBe(course.id);
    expect(stray.courseVersion).toBe(course.version);
  });

  it("keeps the learner's own reading", () => {
    const kept = localProgress(course, {
      units: { [LESSON]: unit(LESSON) },
      startedUtc: "2026-07-01T00:00:00Z",
    });
    expect(kept.units[LESSON].status).toBe("completed");
    expect(kept.startedUtc).toBe("2026-07-01T00:00:00Z");
  });
});

// ── The wire projection ─────────────────────────────────────────────────────

const dto = (over: Partial<LearningProgressDto> = {}): LearningProgressDto => ({
  courseId: course.id,
  courseVersion: course.version,
  startedUtc: "2026-07-01T00:00:00Z",
  completedUtc: null,
  lastActivityUtc: "2026-07-30T00:00:00Z",
  units: [],
  certificate: null,
  ...over,
});

describe("projecting the API's answer", () => {
  it("carries every measured field a capstone row has", () => {
    const progress = toCourseProgress(
      dto({
        units: [
          {
            unitId: CAPSTONE,
            unitType: "drill",
            status: "completed",
            score: null,
            attempts: 3,
            bestElapsedMs: 41_000,
            clean: true,
            completedUtc: "2026-07-30T00:00:00Z",
          },
        ],
      }),
      true,
    );
    expect(progress.units[CAPSTONE]).toMatchObject({
      status: "completed",
      attempts: 3,
      bestElapsedMs: 41_000,
      clean: true,
    });
  });

  it("treats an unrecognised status as not yet done", () => {
    const progress = toCourseProgress(
      dto({
        units: [
          {
            unitId: LESSON,
            unitType: "lesson",
            status: "something-new",
            score: null,
            attempts: 0,
            bestElapsedMs: null,
            clean: false,
            completedUtc: null,
          },
        ],
      }),
      true,
    );
    // Anything the client does not understand must not read as completed — a status it cannot
    // interpret is the one case where guessing "done" would hand out a certificate.
    expect(progress.units[LESSON].status).toBe("available");
  });

  it("keeps in-progress distinct from complete, which is what resume rests on", () => {
    const progress = toCourseProgress(
      dto({
        units: [
          {
            unitId: ASSESSMENT,
            unitType: "assessment",
            status: "in-progress",
            score: null,
            attempts: 0,
            bestElapsedMs: null,
            clean: false,
            completedUtc: null,
          },
        ],
      }),
      true,
    );
    expect(progress.units[ASSESSMENT].status).toBe("in-progress");
  });

  it("marks the progress account-backed only when told it is", () => {
    expect(toCourseProgress(dto(), true).accountBacked).toBe(true);
    expect(toCourseProgress(dto(), false).accountBacked).toBe(false);
  });

  it("carries an issued certificate through unchanged", () => {
    const progress = toCourseProgress(
      dto({
        certificate: {
          certificateId: "hoc-0123456789abcdef0123456789abcdef",
          courseId: course.id,
          courseVersion: 1,
          courseTitle: course.title,
          learnerName: "Isaac",
          issuedUtc: "2026-07-30T00:00:00Z",
          skills: ["Observability", "Capacity"],
        },
      }),
      true,
    );
    expect(progress.certificate?.certificateId).toBe(
      "hoc-0123456789abcdef0123456789abcdef",
    );
    expect(progress.certificate?.skills).toEqual(["Observability", "Capacity"]);
  });
});

// ── The client's half of the contract ───────────────────────────────────────

type Call = { url: string; init?: RequestInit };

function stubFetch(
  responder: (call: Call) => { status: number; body: unknown },
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responder({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
  return calls;
}

const okProgress = () => ({ status: 200, body: dto() });

describe("the learning client", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("asks for progress by course and version, uncached", async () => {
    const calls = stubFetch(okProgress);
    await fetchLearningProgress(course);
    expect(calls[0].url).toBe(
      `/api/live/learning/progress?courseId=${course.id}&courseVersion=${course.version}`,
    );
    expect(calls[0].init).toMatchObject({ cache: "no-store" });
  });

  it("records a start against the learning API, not the browser", async () => {
    const calls = stubFetch(okProgress);
    await startUnit(course, ASSESSMENT);
    expect(calls[0].url).toBe(
      `/api/live/learning/units/${encodeURIComponent(ASSESSMENT)}/start`,
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      courseId: course.id,
      courseVersion: course.version,
    });
  });

  it("reports a checkpoint score to the API and takes back what the API says", async () => {
    const calls = stubFetch(() => ({
      status: 200,
      body: dto({
        units: [
          {
            unitId: CHECKPOINT,
            unitType: "checkpoint",
            status: "completed",
            // The API keeps the best score, so the answer is not necessarily what was sent.
            score: 100,
            attempts: 2,
            bestElapsedMs: null,
            clean: false,
            completedUtc: "2026-07-30T00:00:00Z",
          },
        ],
      }),
    }));

    const answer = await completeUnit(CHECKPOINT, {
      courseId: course.id,
      courseVersion: course.version,
      score: 71,
    });

    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      score: 71,
    });
    expect(answer.units[0].score).toBe(100);
  });

  it("surfaces the refusal when the browser reports a cluster unit", async () => {
    // The one rule that keeps a capstone honest, seen from the client side.
    stubFetch(() => ({
      status: 409,
      body: {
        error:
          "Cluster units are completed by the run broker after a measured solve.",
      },
    }));

    const failure = await completeUnit(CAPSTONE, {
      courseId: course.id,
      courseVersion: course.version,
      clean: true,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(LearningError);
    expect((failure as LearningError).status).toBe(409);
    expect((failure as LearningError).message).toContain("run broker");
  });

  it("reports being signed out as 401 rather than as a failure to explain", async () => {
    stubFetch(() => ({ status: 401, body: { error: "Sign in." } }));
    const failure = await fetchLearningProgress(course).catch(
      (e: unknown) => e as LearningError,
    );
    expect(failure).toBeInstanceOf(LearningError);
    expect((failure as LearningError).status).toBe(401);
  });

  it("sends no claim of eligibility when asking for a certificate", async () => {
    const calls = stubFetch(() => ({
      status: 200,
      body: {
        certificateId: "hoc-0123456789abcdef0123456789abcdef",
        courseId: course.id,
        courseVersion: 1,
        courseTitle: course.title,
        learnerName: "Isaac",
        issuedUtc: "2026-07-30T00:00:00Z",
        skills: ["Observability"],
      },
    }));

    await issueCertificate(course, ["Observability"]);

    const body = JSON.parse(String(calls[0].init?.body));
    expect(Object.keys(body).sort()).toEqual([
      "courseId",
      "courseVersion",
      "skills",
    ]);
    // No learner name either: the API resolves that from the verified session, so nobody can be
    // issued a certificate in someone else's name.
    expect(body).not.toHaveProperty("learnerName");
    expect(body).not.toHaveProperty("eligible");
  });

  it("carries the outstanding requirements back from a refused certificate", async () => {
    stubFetch(() => ({
      status: 409,
      body: {
        error: "The course is not complete.",
        outstanding: [
          "final assessment outstanding",
          "2 capstone(s) outstanding",
        ],
      },
    }));

    const failure = await issueCertificate(course, []).catch(
      (e: unknown) => e as LearningError,
    );
    expect((failure as LearningError).outstanding).toEqual([
      "final assessment outstanding",
      "2 capstone(s) outstanding",
    ]);
  });
});
