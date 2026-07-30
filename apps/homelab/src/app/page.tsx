import type { Metadata } from "next";
import HomeOverview from "@/widgets/HomeOverview";

export const metadata: Metadata = {
  // The landing page keeps the full brand line rather than "Overview · HomeOps".
  title: { absolute: "HomeOps — operate a real homelab platform" },
  description:
    "A sanitized live view of a real three-node K3s platform: node readiness, workload health, resource use, GitOps state, and how much sandbox capacity is free right now.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <HomeOverview />;
}
