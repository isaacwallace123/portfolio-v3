import type { Metadata } from "next";
import ClusterWorkbench from "@/widgets/cluster-workbench";

export const metadata: Metadata = {
  title: "Ranked",
  description:
    "Compete in server-drawn Kubernetes incidents, climb the seasonless HomeOps rating ladder, and chase verified speed records.",
  alternates: { canonical: "/ranked" },
};

export default function RankedPage() {
  return <ClusterWorkbench surface="ranked" />;
}
