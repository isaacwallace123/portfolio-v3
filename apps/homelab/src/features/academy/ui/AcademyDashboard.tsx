"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  Award,
  GraduationCap,
  Info,
  Loader2,
  ArrowRight,
  Terminal,
  Trophy,
  TriangleAlert,
} from "lucide-react";
import { ACADEMY_COURSE } from "../content/production-operations";
import { useAcademyProgress } from "../model/useAcademyProgress";
import { eligibility } from "../model/progress";
import { CourseMap } from "./CourseMap";
import { SkillProfile } from "./SkillProfile";
import styles from "./academy.module.css";

// The Academy dashboard.
//
// It has to answer five questions above the fold: what course am I taking, how far through am I,
// what should I do next, which skills have I actually demonstrated, and can I get into the open
// sandbox. Everything else on this page is subordinate to those, which is why there is exactly one
// button styled as a primary action.

export function AcademyDashboard() {
  const course = ACADEMY_COURSE;
  const { progress, state, loading, error } = useAcademyProgress(course);

  const percent = Math.round(
    (state.unitsComplete / Math.max(1, state.unitsTotal)) * 100,
  );
  const certificate = progress.certificate;
  const certificateReady = eligibility(course, progress, state).eligible;

  if (loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Loading your
          course…
        </p>
      </div>
    );

  return (
    <div className={styles.shell}>
      <header>
        <p className={styles.eyebrow}>
          <GraduationCap size={13} aria-hidden />
          HomeOps Academy
        </p>
        <h1 className={styles.title}>Learn the system. Then prove it.</h1>
        <p className={styles.lede}>{course.summary}</p>
      </header>

      {!progress.accountBacked && (
        <div
          className={styles.notice}
          data-tone="warn"
          style={{ marginTop: 26 }}
        >
          <TriangleAlert size={15} aria-hidden />
          <span>
            You are not signed in, so your progress is being kept in this
            browser. It will move to your account when you sign in — but a
            certificate is only ever issued against an account.
          </span>
        </div>
      )}

      {error && (
        <div
          className={styles.notice}
          data-tone="warn"
          style={{ marginTop: 14 }}
        >
          <TriangleAlert size={15} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* ── The one primary action ─────────────────────────────────────── */}
      <section className={styles.continueCard}>
        <span>{course.title}</span>
        <h2>
          {state.segmentsComplete} of {state.segmentsTotal} segments complete
        </h2>
        <p>
          {state.resume
            ? `Next up: ${state.resume.label}`
            : certificate
              ? "You have completed the course and been issued your certificate."
              : certificateReady
                ? "Every requirement is met. Claim your certificate."
                : "Every segment is done — the final assessment is what closes the course."}
        </p>

        <div className={styles.progressLine}>
          <div
            className={styles.progressTrack}
            role="meter"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Course progress"
          >
            <div
              className={styles.progressFill}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className={styles.progressMeta}>
            <span>
              <b>{percent}%</b> complete
            </span>
            <span>
              capstones{" "}
              <b>
                {state.capstonesComplete}/{state.segmentsTotal}
              </b>
            </span>
            <span>
              clean solves <b>{state.cleanCapstones}</b>
            </span>
            <span>
              knowledge checks{" "}
              <b>{state.checkScore !== null ? `${state.checkScore}%` : "—"}</b>
            </span>
          </p>
        </div>

        <div className={styles.actions}>
          {state.resume ? (
            <Link className={styles.primary} href={state.resume.href as Route}>
              Continue learning
              <ArrowRight size={15} aria-hidden />
            </Link>
          ) : (
            <Link className={styles.primary} href="/practice/certificate">
              <Award size={15} aria-hidden />
              {certificate ? "View your certificate" : "Finish the course"}
            </Link>
          )}
          <Link
            className={styles.quiet}
            href="/practice/path/production-operations"
          >
            Full course outline
            <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </section>

      {/* ── Course map ─────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Course map</h2>
          <p>
            Segment 1 comes first because everything else assumes it. After that
            the middle of the course is open — capstones gate the certificate,
            not the reading.
          </p>
        </div>
        <CourseMap
          course={course}
          states={state.segments}
          progress={progress}
        />
      </section>

      {/* ── Skill profile ──────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Skill profile</h2>
          <p>
            Academy mastery, not a rating. A skill counts as demonstrated when
            its capstone was solved on real infrastructure.
          </p>
        </div>
        <SkillProfile skills={state.skills} />
      </section>

      {/* ── Everything that is not the course ──────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Other ways in</h2>
          <p>
            The course is one way to use the platform. These are the others, and
            they are deliberately kept apart from it.
          </p>
        </div>
        <div className={styles.options}>
          <Link className={styles.option} href="/practice/sandbox">
            <Terminal size={17} aria-hidden />
            <b>Open sandbox</b>
            <p>
              A disposable Kubernetes cluster with every control unlocked and
              nothing to achieve. Break it however you like.
            </p>
            <small>No objective · no course progress · no ranking</small>
          </Link>

          <Link className={styles.option} href="/practice/certificate">
            <Award size={17} aria-hidden />
            <b>Certificate of completion</b>
            <p>
              What the course requires, how far you are from it, and the
              certificate itself once every requirement is met.
            </p>
            <small>
              {certificate
                ? "Issued"
                : certificateReady
                  ? "Ready to claim"
                  : "Requirements outstanding"}
            </small>
          </Link>

          <Link className={styles.option} href="/ranked">
            <Trophy size={17} aria-hidden />
            <b>HomeOps Ranked</b>
            <p>
              A separate competitive surface: server-drawn incidents, one shot,
              an official time. Nothing you do here affects your course.
            </p>
            <small>Competitive · not part of the Academy</small>
          </Link>
        </div>
      </section>

      <p className={styles.notice} data-tone="info" style={{ marginTop: 36 }}>
        <Info size={15} aria-hidden />
        <span>
          Lesson diagrams are deterministic illustrations and are labelled as
          such. Every capstone runs on a real, disposable Kubernetes namespace
          on the live homelab, and every number in one is measured.
        </span>
      </p>
    </div>
  );
}
