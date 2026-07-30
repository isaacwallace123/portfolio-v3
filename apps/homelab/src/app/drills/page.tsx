import type { Metadata } from "next";
import { redirect } from "next/navigation";

// Drills and the practice cluster are one surface now: a drill runs ON the cluster you provision.
// The route is kept because it was linked, but it is not a page — so it stays out of the index
// rather than competing with /practice for the same content.
export const metadata: Metadata = {
  title: "Drills",
  description: "Incident drills run on the practice cluster.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/practice" },
};

export default function DrillsPage() {
  redirect("/practice");
}
