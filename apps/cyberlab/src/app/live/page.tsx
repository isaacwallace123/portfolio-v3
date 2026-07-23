import type { Metadata } from "next";
import LiveView from "@/widgets/LiveView";
import { getCaseStudies } from "@/entities/scenario/scenarios";
import { getLiveState } from "@/entities/scenario/liveSim";

export const metadata: Metadata = {
  title: "Live",
  description:
    "Watch scenarios running now on the cyberlab VMs — a read-only, non-interactive view.",
};

// Always fresh: the live view is the opposite of cacheable.
export const dynamic = "force-dynamic";

export default function LivePage() {
  const initial = getLiveState();
  const queueOptions = getCaseStudies().map((s) => ({
    id: s.id,
    title: s.title,
  }));

  return (
    <section className="shell py-[clamp(40px,7vw,84px)]">
      <div className="mb-6 flex flex-col gap-2" data-lab-reveal>
        <div className="eyebrow">Live</div>
        <h1 className="text-[clamp(21px,3vw,30px)] font-bold tracking-[-0.01em]">
          What&apos;s running now
        </h1>
        <p className="max-w-[72ch] text-[15px] text-ink-mid">
          The range runs scenarios continuously. This is a read-only window onto
          the VM that&apos;s currently acting — you watch what happens, step by
          step, and can queue another scenario to run next. You can&apos;t touch
          the machines; the view is one-way by design.
        </p>
      </div>
      <LiveView initial={initial} queueOptions={queueOptions} />
    </section>
  );
}
