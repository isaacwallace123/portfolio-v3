import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import ScenarioPlayer from "@/widgets/ScenarioPlayer";
import { Badge } from "@/shared/ui/badge";
import { getCaseStudies, getCaseStudy } from "@/entities/scenario/scenarios";
import { rolesOf, ROLE_LABEL } from "@/entities/scenario/recording";

export function generateStaticParams() {
  return getCaseStudies().map((s) => ({ id: s.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const study = getCaseStudy(id);
  if (!study) return { title: "Case study not found" };
  return { title: study.title, description: study.summary };
}

export default async function CaseStudyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const study = getCaseStudy(id);
  if (!study) notFound();

  return (
    <section className="shell py-[clamp(40px,7vw,84px)]">
      <Link
        href="/scenarios"
        className="mb-[18px] inline-flex items-center gap-1.5 rounded-md text-[13px] text-ink-mid transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All case studies
      </Link>

      <div className="mb-[22px] flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {rolesOf(study).map((role) => (
            <span
              key={role}
              className="role-tag"
              style={{ ["--role" as string]: `var(--${role})` }}
            >
              {ROLE_LABEL[role]}
            </span>
          ))}
          {study.recorded && <Badge variant="capture">Real capture</Badge>}
        </div>
        <h1 className="text-[clamp(22px,3.4vw,33px)] font-extrabold tracking-[-0.01em]">
          {study.title}
        </h1>
        <p className="max-w-[68ch] text-[15.5px] leading-[1.65] text-ink-mid">
          {study.summary}
        </p>
      </div>

      <ScenarioPlayer study={study} />

      {study.purpose && (
        <div className="mt-[22px] rounded-[10px] border border-l-[3px] border-line border-l-primary bg-[color-mix(in_srgb,var(--accent)_7%,var(--panel))] px-[18px] py-4">
          <span className="font-mono text-[10px] font-bold tracking-[0.2em] text-[color-mix(in_srgb,var(--accent)_85%,#fff)] uppercase">
            Why this matters
          </span>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink">
            {study.purpose}
          </p>
        </div>
      )}

      {study.tags && study.tags.length > 0 && (
        <div className="mt-[18px] flex flex-wrap gap-2">
          {study.tags.map((t) => (
            <Badge key={t} variant="outline" className="py-1.5 text-[11px]">
              {t}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}
