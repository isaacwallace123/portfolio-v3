import type { Metadata } from "next";
import ClusterWorkbench from "@/widgets/cluster-workbench";

export const metadata: Metadata = {
  title: "Ranked",
  description:
    "Enter a server-drawn, multi-stage incident on a real isolated Kubernetes workload. Every result moves seasonless ELO; clean recoveries also record an official time.",
  alternates: { canonical: "/ranked" },
};

export default function RankedPage() {
  return <ClusterWorkbench surface="ranked" />;
}
