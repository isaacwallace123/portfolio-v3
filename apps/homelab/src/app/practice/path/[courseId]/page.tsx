import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ACADEMY_COURSE, CoursePath } from "@/features/academy";

export const metadata: Metadata = {
  title: "Production Operations Foundations",
  description:
    "The full HomeOps Academy course outline: seven segments, their learning outcomes, their real-cluster capstones, and the final assessment.",
  alternates: { canonical: "/practice/path/production-operations" },
};

// One course exists today, and the route is parameterised anyway — the segment and lesson routes
// are already course-agnostic, and a second track should not need a new page component.
export function generateStaticParams() {
  return [{ courseId: ACADEMY_COURSE.id }];
}

export default async function CoursePathPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  if (courseId !== ACADEMY_COURSE.id) notFound();
  return <CoursePath course={ACADEMY_COURSE} />;
}
