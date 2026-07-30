import type { Metadata } from "next";
import { ACADEMY_COURSE, FinalAssessment } from "@/features/academy";

// The final assessment's own page. The drill itself still runs at /practice/drill/<id>?assessment=1
// — this is what comes before it: the rules, the blueprint, what is still outstanding if it is
// locked, and what completing it does to the certificate.
export const metadata: Metadata = {
  title: "Final assessment",
  description:
    "The HomeOps Academy final assessment: one real disposable Kubernetes cluster, more than one fault, and no indication of which part of the course each one belongs to. Unranked and retryable.",
  alternates: { canonical: "/practice/assessment" },
};

export default function FinalAssessmentPage() {
  return <FinalAssessment course={ACADEMY_COURSE} />;
}
