import type { Metadata } from "next";
import { AcademyDashboard } from "@/features/academy";

// /practice is the Academy now. The open cluster workspace moved to /practice/sandbox, where it is
// one clearly separate option rather than the whole surface — a visitor should be able to start
// learning without provisioning anything.
export const metadata: Metadata = {
  title: "Academy",
  description:
    "HomeOps Academy: a structured course in production operations. Short lessons, animated explanations, knowledge checks, and capstone incidents resolved on real disposable Kubernetes clusters.",
  alternates: { canonical: "/practice" },
};

export default function PracticePage() {
  return <AcademyDashboard />;
}
