"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  Award,
  Check,
  ChevronRight,
  CircleDot,
  Info,
  Loader2,
  Lock,
  Radio,
  RotateCcw,
  Target,
  TriangleAlert,
} from "lucide-react";
import { clock } from "@/shared/lib/format";
import type { LearningCourse } from "../model/course";
import { drillTitle } from "../model/course";
import {
  assessmentBlueprint,
  assessmentDrillHref,
  ASSESSMENT_RULES,
  BLUEPRINT_CAVEAT,
  assessmentStanding,
  standingAnnouncement,
} from "../model/assessment";
import { useAnimationAllowed } from "../model/motion";
import { useAcademyProgress } from "../model/useAcademyProgress";
import styles from "./academy.module.css";

// The final assessment, before the cluster exists.
//
// The drill itself is unchanged — the same `double-fault` scenario, launched down the same Academy
// practice path, judged the same way. What was missing was everything around it: a learner used to
// go from a one-line card on the course outline straight into a provisioning screen, with the rules
// of the thing they were about to be assessed on never stated.
//
// So this page states them. What it is, what it is not, which domains it draws on, what is still
// outstanding if it is locked, and what completing it does to the certificate. It renders no
// telemetry and computes no score: every number on it comes from recorded progress, and the
// judging still happens on the cluster.

export function FinalAssessment({ course }: { course: LearningCourse }) {
  const { progress, state, loading, error } = useAcademyProgress(course);
  const animate = useAnimationAllowed();

  if (loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton} role="status">
          <Loader2 size={16} className="spin" aria-hidden /> Checking your
          readiness for the final assessment…
        </p>
      </div>
    );

  const standing = assessmentStanding(course, progress, state);
  const blueprint = assessmentBlueprint(course, state);
  const launchHref = assessmentDrillHref(course) as Route;
  const stateLabel = !standing.unlocked
    ? "Locked"
    : standing.completed
      ? "Completed"
      : standing.started
        ? "Attempt in progress"
        : "Unlocked";

  return (
    <div className={styles.shell}>
      <header className={styles.lessonHead}>
        <p className={styles.crumbs}>
          <Link href="/practice">Academy</Link>
          <ChevronRight size={12} aria-hidden />
          <Link href={`/practice/path/${course.id}` as Route}>
            {course.title}
          </Link>
          <ChevronRight size={12} aria-hidden />
          <span>Final assessment</span>
        </p>
        <h1>{course.finalAssessmentTitle}</h1>
        <p className={styles.lede}>{course.finalAssessmentSummary}</p>
        <p className={styles.lessonMeta} style={{ marginTop: 18 }}>
          <span>unranked</span>
          <span>retryable</span>
          <span>no ELO</span>
          <span>real disposable cluster</span>
          <span>scenario · {drillTitle(course.finalAssessmentDrillId)}</span>
        </p>
      </header>

      {/* The standing resolves after an async progress load, so it is announced rather than only
          drawn. `role="status"` is polite by default, which is right for a page the learner is
          already reading. */}
      <p className={styles.srOnly} role="status">
        {standingAnnouncement(standing)}
      </p>

      {error && (
        <div
          className={styles.notice}
          data-tone="warn"
          style={{ marginTop: 26 }}
        >
          <TriangleAlert size={15} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* ── The launch control ─────────────────────────────────────────── */}
      <section
        className={styles.assessCard}
        data-stage={standing.stage}
        data-complete={standing.completed}
      >
        <div className={styles.assessCardHead}>
          <span className={styles.statusTag} data-state={assessTone(standing)}>
            {stateLabel}
          </span>
          <h2>
            {standing.completed
              ? "You have completed the final assessment"
              : standing.unlocked
                ? "Everything the course taught, with nothing telling you which is which"
                : "Not yet open"}
          </h2>
          <p>
            {standing.completed
              ? "It is the last unit in the course. Running it again can only improve what is on record — a clean solve that already happened is never erased by a messier one."
              : standing.unlocked
                ? "One cluster, more than one fault. You are not told which segment a fault belongs to, and no hint arrives before an operational decision."
                : standing.lockedBecause}
          </p>
        </div>

        {standing.unlocked && standing.attempts > 0 && (
          <dl className={styles.assessFacts}>
            <div>
              <dt>Attempts recorded</dt>
              <dd>{standing.attempts}</dd>
            </div>
            <div>
              <dt>Best measured time</dt>
              <dd>
                {standing.bestElapsedMs !== null
                  ? clock(standing.bestElapsedMs)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Clean solve on record</dt>
              <dd>{standing.clean ? "yes" : "no"}</dd>
            </div>
          </dl>
        )}

        <div className={styles.actions}>
          {standing.unlocked ? (
            <Link className={styles.primary} href={launchHref}>
              {standing.completed ? (
                <RotateCcw size={15} aria-hidden />
              ) : (
                <Radio size={15} aria-hidden />
              )}
              {standing.actionLabel}
              <ArrowRight size={14} aria-hidden />
            </Link>
          ) : (
            /* No launch button when it cannot work. A disabled primary on a page whose whole
               subject is the thing it launches reads as a broken page, not as a locked one. */
            <p className={styles.notice} data-tone="warn" style={{ margin: 0 }}>
              <Lock size={15} aria-hidden />
              <span>{standing.lockedBecause}</span>
            </p>
          )}
          {standing.completed && (
            <Link className={styles.quiet} href="/practice/certificate">
              <Award size={13} aria-hidden />
              Certificate requirements
            </Link>
          )}
        </div>
      </section>

      {/* ── What this is ───────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>What this is</h2>
          <p>
            Stated before you provision anything, because an assessment whose
            rules arrive halfway through is testing the wrong thing.
          </p>
        </div>
        <ul className={styles.ruleList}>
          {ASSESSMENT_RULES.map((rule) => (
            <li key={rule.id} className={styles.rule}>
              <Check size={14} aria-hidden />
              <div>
                <b>{rule.label}</b>
                <small>{rule.detail}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Blueprint ──────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Assessment blueprint</h2>
          <p>
            The seven domains the course builds, and what each one is doing
            while you work the incident.
          </p>
        </div>

        <ol className={styles.blueprint} data-animate={animate}>
          {blueprint.map((row, i) => (
            <li
              key={row.domain}
              className={styles.blueprintRow}
              data-demonstrated={row.demonstrated}
              /* The stagger index, as a custom property. Only set when the animation is allowed,
                 so nothing is left behind on the settled render. */
              style={animate ? ({ "--i": i } as CSSProperties) : undefined}
            >
              <span className={styles.blueprintIndex} aria-hidden>
                {row.segmentOrder}
              </span>
              <div className={styles.blueprintBody}>
                <div className={styles.blueprintHead}>
                  <b>{row.label}</b>
                  <Link
                    className={styles.blueprintLink}
                    href={`/practice/segment/${row.segmentId}` as Route}
                  >
                    {row.segmentTitle}
                    <ChevronRight size={11} aria-hidden />
                  </Link>
                </div>
                <p>{row.contributes}</p>
              </div>
              <span className={styles.blueprintMark}>
                {row.demonstrated ? (
                  <>
                    <Check size={12} aria-hidden />
                    capstone solved
                  </>
                ) : (
                  <>
                    <CircleDot size={12} aria-hidden />
                    capstone pending
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>

        <p className={styles.notice} data-tone="info" style={{ marginTop: 16 }}>
          <Info size={15} aria-hidden />
          <span>{BLUEPRINT_CAVEAT}</span>
        </p>
      </section>

      {/* ── Readiness ──────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Readiness</h2>
          <p>
            The assessment opens once every segment is genuinely complete — its
            lessons, its checkpoint, and its real-cluster capstone.
          </p>
        </div>

        {standing.outstanding.length > 0 ? (
          <div className={styles.unitList}>
            {standing.outstanding.map((segment) => (
              <Link
                key={segment.segmentId}
                className={styles.unit}
                href={segment.href as Route}
              >
                <span className={styles.unitIcon}>
                  <Lock size={15} aria-hidden />
                </span>
                <span className={styles.unitBody}>
                  <b>
                    {segment.order}. {segment.title}
                  </b>
                  <small>{segment.missing.join(" · ")}</small>
                </span>
                <span className={styles.unitAside}>Resume</span>
              </Link>
            ))}
          </div>
        ) : (
          <ul className={styles.outcomes}>
            <li>
              <Target size={13} aria-hidden />
              <span>
                All {course.segments.length} segments read, checkpointed and
                proven on a real cluster.
              </span>
            </li>
            <li>
              <Target size={13} aria-hidden />
              <span>
                {state.cleanCapstones} of {state.segmentsTotal} capstones solved
                with no wrong operational action.
              </span>
            </li>
            <li>
              <Target size={13} aria-hidden />
              <span>
                Knowledge checks averaging{" "}
                {state.checkScore !== null ? `${state.checkScore}%` : "—"}{" "}
                across the seven checkpoints.
              </span>
            </li>
          </ul>
        )}
      </section>

      {/* ── Certificate standing ───────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>What completing it does</h2>
          <p>
            The final assessment is one certificate requirement among seven. It
            is the last one, not the only one.
          </p>
        </div>

        <div className={styles.assessCertificate}>
          {standing.certificate.issued ? (
            <p className={styles.assessCertificateLede}>
              Your certificate has been issued. The assessment is on record
              against it.
            </p>
          ) : standing.certificate.eligible ? (
            <p className={styles.assessCertificateLede}>
              Every requirement is met. The certificate is ready to claim.
            </p>
          ) : (
            <>
              <p className={styles.assessCertificateLede}>
                {standing.completed
                  ? "The assessment is complete, but the certificate is not yet eligible. What remains:"
                  : "Completing the assessment satisfies one requirement. These are the ones still outstanding:"}
              </p>
              <ul className={styles.remaining}>
                {standing.certificate.remaining.map((req) => (
                  <li key={req.id}>
                    <CircleDot size={13} aria-hidden />
                    <span>
                      <b>{req.label}</b>
                      {req.progress && (
                        <em>
                          {req.progress.have} / {req.progress.need}
                        </em>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className={styles.assessDisclaimer}>
            This is a HomeOps Certificate of Completion. It records work done on
            this platform and nothing more — it is not an industry
            certification, and it is not endorsed by, affiliated with, or
            accredited by AWS, the Kubernetes project, the CNCF, or any other
            organisation.
          </p>

          <div className={styles.actions}>
            <Link className={styles.secondary} href="/practice/certificate">
              <Award size={14} aria-hidden />
              Certificate requirements
            </Link>
            <Link
              className={styles.quiet}
              href={`/practice/path/${course.id}` as Route}
            >
              Full course outline
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Reuses the course map's status colouring rather than inventing a second vocabulary for it. */
function assessTone(standing: {
  unlocked: boolean;
  completed: boolean;
  started: boolean;
}): string {
  if (!standing.unlocked) return "locked";
  if (standing.completed) return "complete";
  return standing.started ? "in-progress" : "available";
}
