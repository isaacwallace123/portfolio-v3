"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Award,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  Loader2,
  Printer,
  TriangleAlert,
} from "lucide-react";
import { HOMELAB_URL } from "@iw/core";
import type { LearningCourse } from "../model/course";
import type { IssuedCertificate } from "../model/progress";
import { demonstratedSkills, eligibility } from "../model/progress";
import { useAcademyProgress } from "../model/useAcademyProgress";
import styles from "./academy.module.css";

// The certificate, and what it is honest about.
//
// It is a HomeOps certificate of completion. It says what the learner did on this platform, names
// the course version it was earned against, and claims nothing about AWS, Kubernetes, the CNCF, or
// any other organisation — because none of them have anything to do with it. That restraint is not
// a legal footnote; it is the difference between a record and a graphic.

const DISCLAIMER =
  "This is a HomeOps certificate of completion. It records work done on the HomeOps platform: seven segments of coursework, seven capstone incidents resolved on real disposable Kubernetes clusters, and a multi-domain final assessment, all judged from measured telemetry. It is not an industry certification and it is not endorsed by, affiliated with, or accredited by AWS, the Kubernetes project, the CNCF, or any other organisation.";

export function CertificateView({ course }: { course: LearningCourse }) {
  const { progress, state, loading, error, outstanding, claimCertificate } =
    useAcademyProgress(course);
  const [claiming, setClaiming] = useState(false);

  if (loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Checking your
          progress…
        </p>
      </div>
    );

  const { eligible, requirements } = eligibility(course, progress, state);
  const certificate = progress.certificate;

  return (
    <div className={styles.shell}>
      {certificate ? (
        <Certificate certificate={certificate} course={course} />
      ) : (
        <header className={styles.lessonHead + " " + styles.noPrint}>
          <p className={styles.crumbs}>
            <Link href="/practice">Academy</Link>
            <ChevronRight size={12} aria-hidden />
            <span>Certificate</span>
          </p>
          <h1>HomeOps Certificate of Completion</h1>
          <p className={styles.lede}>
            {course.title}. Issued against your account when every requirement
            below is met — including seven capstones solved on real clusters,
            which is the part that makes it mean anything.
          </p>
        </header>
      )}

      <section className={`${styles.section} ${styles.noPrint}`}>
        <div className={styles.sectionHead}>
          <h2>{certificate ? "How it was earned" : "Requirements"}</h2>
          <p>
            Every requirement is checked by the platform against persisted
            progress. Nothing here is decided in the browser.
          </p>
        </div>

        <div className={styles.requirements}>
          {requirements.map((req) => (
            <div key={req.id} className={styles.requirement} data-met={req.met}>
              {req.met ? (
                <Check size={16} aria-hidden />
              ) : (
                <Circle size={16} aria-hidden />
              )}
              <div>
                <b>{req.label}</b>
                <small>{req.detail}</small>
              </div>
              <span className={styles.requirementCount}>
                {req.progress
                  ? `${req.progress.have} / ${req.progress.need}`
                  : req.met
                    ? "met"
                    : "—"}
              </span>
            </div>
          ))}
        </div>

        {outstanding.length > 0 && (
          <div
            className={styles.notice}
            data-tone="warn"
            style={{ marginTop: 16 }}
          >
            <TriangleAlert size={15} aria-hidden />
            <span>
              The platform declined to issue: {outstanding.join("; ")}.
            </span>
          </div>
        )}

        {error && !certificate && (
          <div
            className={styles.notice}
            data-tone="warn"
            style={{ marginTop: 14 }}
          >
            <TriangleAlert size={15} aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.actions}>
          {certificate ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => window.print()}
            >
              <Printer size={15} aria-hidden />
              Print or save as PDF
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              disabled={!eligible || claiming}
              onClick={async () => {
                setClaiming(true);
                await claimCertificate(demonstratedSkills(state));
                setClaiming(false);
              }}
            >
              {claiming ? (
                <Loader2 size={15} className="spin" aria-hidden />
              ) : (
                <Award size={15} aria-hidden />
              )}
              {eligible ? "Claim your certificate" : "Requirements outstanding"}
            </button>
          )}
          <Link className={styles.quiet} href="/practice">
            Back to the Academy
          </Link>
        </div>
      </section>
    </div>
  );
}

/** The printable artefact. Also rendered, read-only, by the public verification route. */
export function Certificate({
  certificate,
  course,
  verified = false,
}: {
  certificate: IssuedCertificate;
  course: { title: string } | null;
  /** True when this is the public verification view rather than the holder's own page. */
  verified?: boolean;
}) {
  const verifyUrl = `${HOMELAB_URL}/practice/certificate/${certificate.certificateId}`;
  const issued = new Date(certificate.issuedUtc);

  return (
    <article className={styles.certificate}>
      <header>
        <span>HomeOps Certificate of Completion</span>
        <Award size={22} aria-hidden style={{ color: "var(--mint)" }} />
      </header>

      <h1 className={styles.certificateName}>{certificate.learnerName}</h1>
      <p className={styles.certificateCourse}>
        has completed <b>{course?.title ?? certificate.courseId}</b> on the
        HomeOps platform.
      </p>

      <div className={styles.certificateGrid}>
        <div>
          <span>Course version</span>
          <b>v{certificate.courseVersion}</b>
        </div>
        <div>
          <span>Issued</span>
          <b>
            {issued.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </b>
        </div>
        <div>
          <span>Certificate ID</span>
          <b>{certificate.certificateId}</b>
        </div>
        <div>
          <span>Verify at</span>
          <b>{verifyUrl.replace(/^https?:\/\//, "")}</b>
        </div>
      </div>

      {certificate.skills.length > 0 && (
        <>
          <p
            className={styles.certificateDisclaimer}
            style={{ marginTop: 24, marginBottom: 0 }}
          >
            Skills demonstrated on real Kubernetes workloads:
          </p>
          <div className={styles.certificateSkills}>
            {certificate.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
        </>
      )}

      <p className={styles.certificateDisclaimer}>{DISCLAIMER}</p>

      {verified && (
        <p className={styles.certificateDisclaimer}>
          <Check
            size={12}
            aria-hidden
            style={{ verticalAlign: -2, marginRight: 5, color: "var(--mint)" }}
          />
          Verified against HomeOps records on {new Date().toLocaleDateString()}.{" "}
          <a
            href="https://homelab.isaacwallace.dev/practice"
            className={styles.noPrint}
          >
            About the course <ExternalLink size={10} aria-hidden />
          </a>
        </p>
      )}
    </article>
  );
}
