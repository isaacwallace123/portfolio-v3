import type { Metadata } from "next";
import { TopologyBoard } from "@/features/topology";

export const metadata: Metadata = {
  title: "Live topology",
  description:
    "The homelab as a flowchart: every component ranked by what it depends on, with live readiness, resource use, and GitOps state read from the Kubernetes API.",
  alternates: { canonical: "/topology" },
};

export default function TopologyPage() {
  return <TopologyBoard />;
}
