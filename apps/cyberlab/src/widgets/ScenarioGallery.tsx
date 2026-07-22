"use client";

import type { CaseStudy } from "@/entities/scenario/types";
import CaseStudyCard from "@/widgets/CaseStudyCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

// Client wrapper for the gallery: a Tabs filter over the (server-provided) case studies.
export default function ScenarioGallery({ studies }: { studies: CaseStudy[] }) {
  const scripted = studies.filter((s) => !s.recorded);
  const captured = studies.filter((s) => s.recorded);

  const grid = (list: CaseStudy[]) =>
    list.length === 0 ? (
      <p className="rounded-lg border border-dashed border-line p-6 text-sm text-ink-dim">
        Nothing here yet.
      </p>
    ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <CaseStudyCard key={s.id} study={s} />
        ))}
      </div>
    );

  return (
    <Tabs defaultValue="all">
      <TabsList aria-label="Filter case studies">
        <TabsTrigger value="all">All ({studies.length})</TabsTrigger>
        <TabsTrigger value="scripted">Scripted ({scripted.length})</TabsTrigger>
        <TabsTrigger value="captured">
          Real captures ({captured.length})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="all">{grid(studies)}</TabsContent>
      <TabsContent value="scripted">{grid(scripted)}</TabsContent>
      <TabsContent value="captured">{grid(captured)}</TabsContent>
    </Tabs>
  );
}
