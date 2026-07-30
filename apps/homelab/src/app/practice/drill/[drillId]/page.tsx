import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ACADEMY_COURSE,
  AcademyCapstone,
  findSegment,
  segmentDrillIds,
} from "@/features/academy";

export const metadata: Metadata = {
  title: "Academy field assignment",
  description:
    "Resolve an unranked HomeOps Academy incident on a real disposable Kubernetes cluster.",
  robots: { index: false, follow: false },
};

export default async function AcademyDrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ drillId: string }>;
  searchParams: Promise<{ segment?: string; assessment?: string }>;
}) {
  const [{ drillId }, query] = await Promise.all([params, searchParams]);
  const assessment =
    query.assessment === "1" &&
    drillId === ACADEMY_COURSE.finalAssessmentDrillId;
  const segment = query.segment
    ? findSegment(ACADEMY_COURSE, query.segment)
    : null;
  const segmentOwnsDrill =
    segment !== null && segmentDrillIds(segment).includes(drillId);

  if (!assessment && !segmentOwnsDrill) notFound();

  return (
    <AcademyCapstone
      course={ACADEMY_COURSE}
      drillId={drillId}
      segment={segment}
      assessment={assessment}
    />
  );
}
