import type { Metadata } from "next";
import { ACADEMY_COURSE, CertificateView } from "@/features/academy";

export const metadata: Metadata = {
  title: "Certificate requirements",
  description:
    "Review progress toward the HomeOps Production Operations Foundations certificate of completion.",
  alternates: { canonical: "/practice/certificate" },
};

export default function CertificatePage() {
  return <CertificateView course={ACADEMY_COURSE} />;
}
