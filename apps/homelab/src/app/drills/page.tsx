import type { Metadata } from "next";
import { redirect } from "next/navigation";

// Legacy entry point. Training drills live in Practice; competitive incidents live in /ranked.
export const metadata: Metadata = {
  title: "Drills",
  description: "Incident drills run on the practice cluster.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/practice" },
};

export default function DrillsPage() {
  redirect("/practice");
}
