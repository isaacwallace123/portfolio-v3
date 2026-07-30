import type { CourseProgress, UnitProgress } from "../model/progress";
import type { LearningCourse, UnitType } from "../model/course";

// Browser client for /api/live/learning/*.
//
// Academy-only, and deliberately its own module rather than more functions on the shared live
// client: the arena's client is about a cluster, this is about a course, and the two must not start
// importing each other. Nothing here can reach a Kubernetes workload.

export interface LearningUnitDto {
  unitId: string;
  unitType: UnitType;
  status: string;
  score: number | null;
  attempts: number;
  bestElapsedMs: number | null;
  clean: boolean;
  completedUtc: string | null;
}

export interface LearningCertificateDto {
  certificateId: string;
  courseId: string;
  courseVersion: number;
  courseTitle: string;
  learnerName: string;
  issuedUtc: string;
  skills: string[];
}

export interface LearningProgressDto {
  courseId: string;
  courseVersion: number;
  startedUtc: string | null;
  completedUtc: string | null;
  lastActivityUtc: string | null;
  units: LearningUnitDto[];
  certificate: LearningCertificateDto | null;
}

/** What the learner reports about a unit they just finished. */
export interface CompleteUnitBody {
  courseId: string;
  courseVersion: number;
  score?: number;
  elapsedMs?: number;
  clean?: boolean;
  mastered?: boolean;
  runId?: string;
  presentation?: "guided" | "assisted" | "assessment";
  missteps?: number;
}

export class LearningError extends Error {
  readonly status: number;
  /** Which certificate requirements are outstanding, when the API refused to issue one. */
  readonly outstanding: string[];
  constructor(message: string, status: number, outstanding: string[] = []) {
    super(message);
    this.name = "LearningError";
    this.status = status;
    this.outstanding = outstanding;
  }
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new LearningError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
      Array.isArray(body.outstanding) ? body.outstanding : [],
    );
  return body as T;
}

export async function fetchLearningProgress(
  course: LearningCourse,
): Promise<LearningProgressDto> {
  const res = await fetch(
    `/api/live/learning/progress?courseId=${course.id}&courseVersion=${course.version}`,
    { cache: "no-store" },
  );
  return asJson(res);
}

export async function startUnit(
  course: LearningCourse,
  unitId: string,
): Promise<LearningProgressDto> {
  const res = await fetch(
    `/api/live/learning/units/${encodeURIComponent(unitId)}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId: course.id,
        courseVersion: course.version,
      }),
    },
  );
  return asJson(res);
}

export async function completeUnit(
  unitId: string,
  body: CompleteUnitBody,
): Promise<LearningProgressDto> {
  const res = await fetch(
    `/api/live/learning/units/${encodeURIComponent(unitId)}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return asJson(res);
}

export async function issueCertificate(
  course: LearningCourse,
  skills: string[],
): Promise<LearningCertificateDto> {
  const res = await fetch("/api/live/learning/certificate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      courseId: course.id,
      courseVersion: course.version,
      skills,
    }),
  });
  return asJson(res);
}

export async function verifyCertificate(
  certificateId: string,
): Promise<LearningCertificateDto> {
  const res = await fetch(
    `/api/live/learning/certificates/${encodeURIComponent(certificateId)}`,
    { cache: "no-store" },
  );
  return asJson(res);
}

/** Project the wire shape into the model the UI reasons about. */
export function toCourseProgress(
  dto: LearningProgressDto,
  accountBacked: boolean,
): CourseProgress {
  const units: Record<string, UnitProgress> = {};
  for (const u of dto.units)
    units[u.unitId] = {
      unitId: u.unitId,
      unitType: u.unitType,
      status:
        u.status === "mastered"
          ? "mastered"
          : u.status === "completed"
            ? "completed"
            : u.status === "in-progress"
              ? "in-progress"
              : "available",
      score: u.score,
      attempts: u.attempts,
      bestElapsedMs: u.bestElapsedMs,
      clean: u.clean,
      completedUtc: u.completedUtc,
    };

  return {
    courseId: dto.courseId,
    courseVersion: dto.courseVersion,
    startedUtc: dto.startedUtc,
    completedUtc: dto.completedUtc,
    lastActivityUtc: dto.lastActivityUtc,
    units,
    certificate: dto.certificate
      ? {
          certificateId: dto.certificate.certificateId,
          courseId: dto.certificate.courseId,
          courseVersion: dto.certificate.courseVersion,
          learnerName: dto.certificate.learnerName,
          issuedUtc: dto.certificate.issuedUtc,
          skills: dto.certificate.skills,
        }
      : null,
    accountBacked,
  };
}
