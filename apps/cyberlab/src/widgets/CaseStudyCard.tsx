import Link from "next/link";
import type { CaseStudy } from "@/entities/scenario/types";
import { Badge } from "@/shared/ui/badge";

// Server component: a gallery card. The colour strip weights each actor by how many steps it drives,
// so at a glance you can see whether a case study is attacker-heavy, a balanced attack/defend, etc.
export default function CaseStudyCard({ study }: { study: CaseStudy }) {
  const counts: Record<string, number> = {};
  for (const s of study.steps) {
    const role = (
      study.terminals.find((t) => t.id === s.terminal) ?? study.terminals[0]
    ).role;
    counts[role] = (counts[role] ?? 0) + 1;
  }

  return (
    <Link
      href={`/scenarios/${study.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-panel transition-[transform,border-color,box-shadow] duration-(--dur-base) ease-(--ease-out) outline-none hover:translate-y-[-3px] hover:border-[color-mix(in_srgb,var(--accent)_42%,var(--line))] hover:shadow-(--shadow-2) focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <div aria-hidden className="flex h-[5px] gap-0.5">
        {study.terminals.map((t, i) => (
          <i
            key={i}
            className="block h-full bg-(--role)"
            style={{
              flex: counts[t.role] ?? 1,
              ["--role" as string]: `var(--${t.role})`,
            }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="text-[15.5px] leading-[1.3] font-bold">
          {study.title}
        </div>
        <div className="line-clamp-3 flex-1 text-[12.8px] leading-normal text-ink-mid">
          {study.summary}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <div aria-hidden className="flex gap-[5px]">
            {study.terminals.map((t, i) => (
              <i
                key={i}
                className="size-[9px] rounded-[3px] bg-(--role)"
                style={{ ["--role" as string]: `var(--${t.role})` }}
              />
            ))}
          </div>
          <Badge size="sm">
            {study.terminals.length} actor
            {study.terminals.length === 1 ? "" : "s"}
          </Badge>
          <Badge size="sm">{study.steps.length} steps</Badge>
          {study.recorded && (
            <Badge size="sm" variant="capture" className="ml-auto">
              Real capture
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}
