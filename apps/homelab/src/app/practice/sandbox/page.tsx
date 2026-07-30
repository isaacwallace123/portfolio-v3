import type { Metadata } from "next";
import ClusterWorkbench from "@/widgets/cluster-workbench";

// The open cluster workspace, unchanged: a real disposable Kubernetes namespace with every control
// unlocked, no objective, and no course progress. It is deliberately reachable without going near
// the Academy, and going near it does not affect a course.
export const metadata: Metadata = {
  title: "Open sandbox",
  description:
    "Provision a disposable Kubernetes cluster on the live homelab and operate it freely. No objective, no course progress, no ranking.",
  alternates: { canonical: "/practice/sandbox" },
};

export default function SandboxPage() {
  return <ClusterWorkbench surface="practice" />;
}
