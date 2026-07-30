import type { KnowledgeCheck } from "./course";

// Scoring a checkpoint.
//
// A check is answered once. Retrying after reading the explanation is encouraged — that is what the
// explanation is for — but the score keeps the FIRST answer, so the number means "did you reason it
// out" rather than "did you keep clicking". The learner is told this before they start.

export type CheckAnswers = Record<string, string>;

export interface CheckOutcome {
  checkId: string;
  chosenOptionId: string;
  correct: boolean;
}

export function gradeCheck(
  check: KnowledgeCheck,
  chosenOptionId: string,
): CheckOutcome {
  const option = check.options.find((o) => o.id === chosenOptionId);
  return {
    checkId: check.id,
    chosenOptionId,
    correct: option?.correct === true,
  };
}

/**
 * Percentage correct over the checks that were actually answered, rounded.
 *
 * Returns null when nothing has been answered: a checkpoint nobody has taken has no score, and
 * calling that zero would drag the course average down for work that has not happened yet.
 */
export function scoreChecks(
  checks: KnowledgeCheck[],
  answers: CheckAnswers,
): number | null {
  const answered = checks.filter((c) => answers[c.id] !== undefined);
  if (answered.length === 0) return null;
  const correct = answered.filter(
    (c) => gradeCheck(c, answers[c.id]).correct,
  ).length;
  return Math.round((correct / answered.length) * 100);
}

/** Every check in the set has an answer recorded. A checkpoint only completes when this is true. */
export function allAnswered(
  checks: KnowledgeCheck[],
  answers: CheckAnswers,
): boolean {
  return checks.length > 0 && checks.every((c) => answers[c.id] !== undefined);
}

/**
 * A content-integrity rule the compiler cannot express: a check with no correct option, or with
 * several, is not a question — it is a bug that reads like a hard question. Asserted by the content
 * test rather than at runtime, because a broken check should never ship at all.
 */
export function checkProblems(check: KnowledgeCheck): string[] {
  const problems: string[] = [];
  const correct = check.options.filter((o) => o.correct);
  if (check.options.length < 2)
    problems.push(`${check.id}: needs at least two options.`);
  if (correct.length !== 1)
    problems.push(
      `${check.id}: has ${correct.length} correct options; exactly one is required.`,
    );
  for (const option of check.options)
    if (option.why.trim().length === 0)
      problems.push(
        `${check.id}/${option.id}: every option must explain itself, right or wrong.`,
      );
  if (check.takeaway.trim().length === 0)
    problems.push(`${check.id}: needs a takeaway.`);
  return problems;
}
