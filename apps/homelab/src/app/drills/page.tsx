import { redirect } from "next/navigation";

// Drills and the practice cluster are one surface now: a drill runs ON the cluster you provision.
export default function DrillsPage() {
  redirect("/practice");
}
