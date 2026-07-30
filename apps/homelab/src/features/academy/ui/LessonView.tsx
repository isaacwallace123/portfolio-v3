"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { findLesson, lessonUnitId, type LearningCourse } from "../model/course";
import type { CheckAnswers } from "../model/checks";
import { isComplete } from "../model/progress";
import { useAcademyProgress } from "../model/useAcademyProgress";
import { LessonPlayer } from "./LessonPlayer";
import styles from "./academy.module.css";

/**
 * The stateful shell around the lesson engine: it owns progress, the learner's in-lesson answers,
 * and where "continue" goes.
 *
 * Answers here are local to the reading. They gate completing the lesson — you cannot skip the
 * reasoning — but the score that counts is recorded at the segment checkpoint, where the learner
 * takes the whole set knowing it is being scored. Grading a page turn is how a course turns into
 * a test nobody reads carefully.
 */
export function LessonView({
  course,
  lessonId,
}: {
  course: LearningCourse;
  lessonId: string;
}) {
  const router = useRouter();
  const { progress, loading, markStarted, markComplete } =
    useAcademyProgress(course);
  const [answers, setAnswers] = useState<CheckAnswers>({});

  const found = findLesson(course, lessonId);

  // Recorded once, when the lesson is opened. Guarded on the id rather than run on every render:
  // a poll landing mid-read must not re-announce that the lesson has started.
  useEffect(() => {
    if (found) markStarted(lessonUnitId(found.lesson.id));
  }, [found, markStarted]);

  if (loading)
    return (
      <div className={styles.shell}>
        <p className={styles.skeleton}>
          <Loader2 size={16} className="spin" aria-hidden /> Loading the lesson…
        </p>
      </div>
    );

  if (!found)
    return (
      <div className={styles.shell}>
        <h1 className={styles.title}>No such lesson</h1>
        <p className={styles.lede}>
          This lesson is not part of {course.title} version {course.version}.
          The course map has everything that is.
        </p>
      </div>
    );

  const { segment, lesson, index } = found;
  const previous = index > 0 ? segment.lessons[index - 1] : null;
  const next =
    index < segment.lessons.length - 1 ? segment.lessons[index + 1] : null;
  const completed = isComplete(progress, lessonUnitId(lesson.id));

  return (
    <LessonPlayer
      course={course}
      segment={segment}
      lesson={lesson}
      previous={previous}
      next={next}
      completed={completed}
      answers={answers}
      onAnswer={(checkId, optionId) =>
        setAnswers((prev) =>
          prev[checkId] !== undefined ? prev : { ...prev, [checkId]: optionId },
        )
      }
      onComplete={async () => {
        if (!completed) await markComplete(lessonUnitId(lesson.id));
        router.push(
          next
            ? `/practice/lesson/${next.id}`
            : `/practice/segment/${segment.id}#checkpoint`,
        );
      }}
    />
  );
}
