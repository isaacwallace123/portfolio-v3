"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  completeUnit,
  fetchLearningProgress,
  issueCertificate,
  LearningError,
  startUnit,
  toCourseProgress,
  type CompleteUnitBody,
} from "../api/learning-client";
import type { LearningCourse } from "./course";
import { courseState, emptyProgress, type CourseProgress } from "./progress";
import { unlockedSegments } from "./unlocks";

// The learner's progress, from wherever it can honestly be kept.
//
// Signed in, it lives in the account and the API is the authority. Signed out, it lives in this
// browser — which is real progress and worth keeping, because being made to create an account
// before reading a lesson is a good way to make sure nobody reads the lesson. What local progress
// can never do is earn a certificate, and `accountBacked` is how the rest of the UI knows.
//
// When a signed-out learner later signs in, whatever they did locally is pushed up once. That is a
// deliberate one-way merge: the account is the record, and local storage is a waiting room.

const STORAGE_PREFIX = "homeops:academy:";

function storageKey(course: LearningCourse) {
  return `${STORAGE_PREFIX}${course.id}:v${course.version}`;
}

function readLocal(course: LearningCourse): CourseProgress {
  if (typeof window === "undefined") return emptyProgress(course);
  try {
    const raw = window.localStorage.getItem(storageKey(course));
    if (!raw) return emptyProgress(course);
    const parsed = JSON.parse(raw) as CourseProgress;
    // Progress from another version of the course is kept in its own key, so anything read here is
    // already the right version. A certificate is never trusted from local storage.
    return {
      ...emptyProgress(course),
      ...parsed,
      certificate: null,
      accountBacked: false,
    };
  } catch {
    return emptyProgress(course);
  }
}

function writeLocal(course: LearningCourse, progress: CourseProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(course), JSON.stringify(progress));
  } catch {
    /* private mode, quota, or a user who has disabled it — the lesson still works */
  }
}

export interface AcademyProgress {
  progress: CourseProgress;
  state: ReturnType<typeof courseState>;
  unlocked: Set<string>;
  loading: boolean;
  /** Set when a write failed. The lesson keeps working; the banner explains what did not save. */
  error: string | null;
  /** Which certificate requirements the API says are outstanding, after a refused issue. */
  outstanding: string[];
  markStarted: (unitId: string) => void;
  markComplete: (
    unitId: string,
    detail?: Omit<CompleteUnitBody, "courseId" | "courseVersion">,
  ) => Promise<void>;
  claimCertificate: (skills: string[]) => Promise<boolean>;
  refresh: () => void;
}

export function useAcademyProgress(course: LearningCourse): AcademyProgress {
  const [progress, setProgress] = useState<CourseProgress>(() =>
    emptyProgress(course),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  // Whether the account is the authority. Held in a ref as well as in state because every write
  // path has to know it without waiting for a render.
  const backed = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    const local = readLocal(course);
    try {
      const dto = await fetchLearningProgress(course);
      backed.current = true;
      const remote = toCourseProgress(dto, true);

      // One-way merge: anything finished locally that the account does not know about is pushed up
      // once, then the account's answer stands. Local rows never overwrite an account row.
      const unsynced = Object.values(local.units).filter(
        (u) =>
          (u.status === "completed" || u.status === "mastered") &&
          remote.units[u.unitId] === undefined,
      );
      if (unsynced.length > 0) {
        await Promise.allSettled(
          unsynced.map((u) =>
            completeUnit(u.unitId, {
              courseId: course.id,
              courseVersion: course.version,
              score: u.score ?? undefined,
              clean: u.clean,
              presentation: "guided",
            }),
          ),
        );
        const merged = await fetchLearningProgress(course);
        setProgress(toCourseProgress(merged, true));
      } else {
        setProgress(remote);
      }
    } catch (e) {
      // 401 is the ordinary signed-out case, not a failure: fall back to local progress silently.
      // Anything else is worth saying, because the learner is about to do work that will not save.
      backed.current = false;
      setProgress(local);
      if (e instanceof LearningError && e.status !== 401)
        setError(
          "Progress is being kept in this browser — the server did not answer.",
        );
    } finally {
      setLoading(false);
    }
  }, [course]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load, reloadToken]);

  const markStarted = useCallback(
    (unitId: string) => {
      setProgress((prev) => {
        if (prev.units[unitId]) return prev;
        const next: CourseProgress = {
          ...prev,
          startedUtc: prev.startedUtc ?? new Date().toISOString(),
          lastActivityUtc: new Date().toISOString(),
          units: {
            ...prev.units,
            [unitId]: {
              unitId,
              unitType: unitId.split(":")[0] as never,
              status: "in-progress",
              score: null,
              attempts: 0,
              bestElapsedMs: null,
              clean: false,
              completedUtc: null,
            },
          },
        };
        if (!backed.current) writeLocal(course, next);
        return next;
      });
      // Fire and forget: opening a lesson should never wait on a round trip, and an in-progress
      // marker that fails to record costs nothing that matters.
      if (backed.current) void startUnit(course, unitId).catch(() => undefined);
    },
    [course],
  );

  const markComplete = useCallback(
    async (
      unitId: string,
      detail?: Omit<CompleteUnitBody, "courseId" | "courseVersion">,
    ) => {
      // Applied locally first so the page responds immediately. If the write fails, the account
      // simply does not have it yet — the next load reconciles.
      setProgress((prev) => {
        const existing = prev.units[unitId];
        const next: CourseProgress = {
          ...prev,
          startedUtc: prev.startedUtc ?? new Date().toISOString(),
          lastActivityUtc: new Date().toISOString(),
          units: {
            ...prev.units,
            [unitId]: {
              unitId,
              unitType: unitId.split(":")[0] as never,
              status: detail?.mastered ? "mastered" : "completed",
              score:
                detail?.score !== undefined
                  ? Math.max(existing?.score ?? 0, detail.score)
                  : (existing?.score ?? null),
              attempts: (existing?.attempts ?? 0) + 1,
              bestElapsedMs:
                detail?.elapsedMs && detail.elapsedMs > 0
                  ? Math.min(
                      existing?.bestElapsedMs ?? Infinity,
                      detail.elapsedMs,
                    )
                  : (existing?.bestElapsedMs ?? null),
              // Sticky: a clean solve that happened stays true through a messier retry.
              clean: existing?.clean || detail?.clean === true,
              completedUtc: existing?.completedUtc ?? new Date().toISOString(),
            },
          },
        };
        if (!backed.current) writeLocal(course, next);
        return next;
      });

      if (!backed.current) return;

      try {
        const dto = await completeUnit(unitId, {
          courseId: course.id,
          courseVersion: course.version,
          ...detail,
        });
        setProgress(toCourseProgress(dto, true));
        setError(null);
      } catch {
        setError(
          "That did not save to your account. It is recorded here for now — reload to try again.",
        );
      }
    },
    [course],
  );

  const claimCertificate = useCallback(
    async (skills: string[]) => {
      setOutstanding([]);
      try {
        await issueCertificate(course, skills);
        const dto = await fetchLearningProgress(course);
        setProgress(toCourseProgress(dto, true));
        return true;
      } catch (e) {
        if (e instanceof LearningError) {
          setOutstanding(e.outstanding);
          setError(e.message);
        } else {
          setError("The certificate could not be issued right now.");
        }
        return false;
      }
    },
    [course],
  );

  const unlocked = useMemo(
    () => unlockedSegments(course, progress),
    [course, progress],
  );
  const state = useMemo(
    () => courseState(course, progress, unlocked),
    [course, progress, unlocked],
  );
  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    progress,
    state,
    unlocked,
    loading,
    error,
    outstanding,
    markStarted,
    markComplete,
    claimCertificate,
    refresh,
  };
}
