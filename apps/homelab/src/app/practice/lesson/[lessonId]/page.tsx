import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ACADEMY_COURSE, findLesson, LessonView } from "@/features/academy";

export function generateStaticParams() {
  return ACADEMY_COURSE.segments.flatMap((segment) =>
    segment.lessons.map((lesson) => ({ lessonId: lesson.id })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}): Promise<Metadata> {
  const { lessonId } = await params;
  const found = findLesson(ACADEMY_COURSE, lessonId);
  if (!found) return { title: "Lesson" };
  return {
    title: found.lesson.title,
    description: found.lesson.summary,
    alternates: { canonical: `/practice/lesson/${found.lesson.id}` },
  };
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  if (!findLesson(ACADEMY_COURSE, lessonId)) notFound();
  return <LessonView course={ACADEMY_COURSE} lessonId={lessonId} />;
}
