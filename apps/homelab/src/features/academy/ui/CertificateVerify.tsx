"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldX } from "lucide-react";
import {
  verifyCertificate,
  type LearningCertificateDto,
} from "../api/learning-client";
import { Certificate } from "./CertificateView";
import styles from "./academy.module.css";

/**
 * Public verification.
 *
 * Anyone with the link can check a certificate — one that only its holder could view would verify
 * nothing. The identifier is random and unguessable, and the response carries what the certificate
 * says and nothing about the account behind it.
 */
export function CertificateVerify({
  certificateId,
}: {
  certificateId: string;
}) {
  const [certificate, setCertificate] = useState<LearningCertificateDto | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "found" | "missing">(
    "loading",
  );

  useEffect(() => {
    let alive = true;
    verifyCertificate(certificateId)
      .then((c) => {
        if (!alive) return;
        setCertificate(c);
        setStatus("found");
      })
      .catch(() => alive && setStatus("missing"));
    return () => {
      alive = false;
    };
  }, [certificateId]);

  if (status === "loading")
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Verifying…
        </p>
      </div>
    );

  if (status === "missing" || !certificate)
    return (
      <div className={styles.shell}>
        <header>
          <p className={styles.eyebrow}>
            <ShieldX size={13} aria-hidden />
            Not verified
          </p>
          <h1 className={styles.title}>No such certificate</h1>
          <p className={styles.lede}>
            HomeOps holds no certificate with this identifier. It may have been
            mistyped, or it may never have been issued.
          </p>
        </header>
        <div className={styles.actions}>
          <Link className={styles.secondary} href="/practice">
            About HomeOps Academy
          </Link>
        </div>
      </div>
    );

  return (
    <div className={styles.shell}>
      <Certificate
        certificate={{
          certificateId: certificate.certificateId,
          courseId: certificate.courseId,
          courseVersion: certificate.courseVersion,
          learnerName: certificate.learnerName,
          issuedUtc: certificate.issuedUtc,
          skills: certificate.skills,
        }}
        course={{ title: certificate.courseTitle }}
        verified
      />
      <div className={`${styles.actions} ${styles.noPrint}`}>
        <Link className={styles.secondary} href="/practice">
          About HomeOps Academy
        </Link>
      </div>
    </div>
  );
}
