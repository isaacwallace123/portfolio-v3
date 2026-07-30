import type { Metadata } from "next";
import ClusterWorkbench from "@/widgets/cluster-workbench";

export const metadata: Metadata = {
  title: "Practice cluster",
  description:
    "Provision a disposable Kubernetes workspace on the live homelab — an isolated namespace with a checkout API, Postgres, Redis, an Envoy gateway and a k6 load generator — then scale it, cache it, break it, and run a timed incident drill on it.",
  alternates: { canonical: "/practice" },
};

export default function PracticePage() {
  return <ClusterWorkbench />;
}
