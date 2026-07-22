import Planned from "@/shared/ui/Planned";

export const metadata = { title: "Cyberlab" };

export default function CyberlabPage() {
  return (
    <Planned
      kicker="Estate"
      title="Cyberlab"
      intro="Operator controls for the cyber range — the privileged side of what the public cyberlab site shows read-only."
      bullets={[
        "Live scenario queue: moderate, reorder, cancel requests",
        "Trigger / tear down disposable scenario runs",
        "Feature or hide case studies on the public site",
        "Recording library: review captures before publishing",
        "Range health: which VMs are up, on which segment",
      ]}
    />
  );
}
