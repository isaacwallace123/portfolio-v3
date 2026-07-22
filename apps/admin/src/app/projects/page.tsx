import Planned from "@/shared/ui/Planned";

export const metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <Planned
      kicker="Estate"
      title="Projects"
      intro="A catalog of everything running across the network — a lightweight Backstage for one person."
      bullets={[
        "Every repo + deployed app with its status",
        "Which image/version is live (from GHCR + ArgoCD)",
        "Deploy history and rollback",
        "Links to CI, logs, and dashboards per project",
        "Ownership + notes per project",
      ]}
    />
  );
}
