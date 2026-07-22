import type { Metadata } from "next";
import ScenarioGallery from "@/widgets/ScenarioGallery";
import { getCaseStudies } from "@/entities/scenario/scenarios";

export const metadata: Metadata = {
  title: "Case studies",
  description:
    "Recorded attack-and-defend scenarios from the cyberlab range, replayed step by step.",
};

export default function ScenariosPage() {
  const studies = getCaseStudies();

  return (
    <section className="shell py-[clamp(40px,7vw,84px)]">
      <div className="mb-6 flex flex-col gap-2">
        <div className="eyebrow">Case studies</div>
        <h1 className="text-[clamp(21px,3vw,30px)] font-bold tracking-[-0.01em]">
          Recorded scenarios
        </h1>
        <p className="max-w-[72ch] text-[15px] text-ink-mid">
          Each scenario was run on the lab VMs and recorded. Open one to replay
          it — terminals type themselves, the SOC reacts, and every step is
          explained beside the stage. Cards marked{" "}
          <strong className="font-semibold text-ink">Real capture</strong> came
          straight from a recording, not a script.
        </p>
      </div>
      <ScenarioGallery studies={studies} />
    </section>
  );
}
