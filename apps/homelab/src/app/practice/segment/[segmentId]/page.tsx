import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ACADEMY_COURSE,
  findSegment,
  SegmentOverview,
} from "@/features/academy";

export function generateStaticParams() {
  return ACADEMY_COURSE.segments.map((segment) => ({ segmentId: segment.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ segmentId: string }>;
}): Promise<Metadata> {
  const { segmentId } = await params;
  const segment = findSegment(ACADEMY_COURSE, segmentId);
  if (!segment) return { title: "Segment" };
  return {
    title: `${segment.order}. ${segment.title}`,
    description: segment.summary,
    alternates: { canonical: `/practice/segment/${segment.id}` },
  };
}

export default async function SegmentPage({
  params,
}: {
  params: Promise<{ segmentId: string }>;
}) {
  const { segmentId } = await params;
  const segment = findSegment(ACADEMY_COURSE, segmentId);
  if (!segment) notFound();
  return <SegmentOverview course={ACADEMY_COURSE} segment={segment} />;
}
