import { describe, expect, it } from "vitest";
import { allAnswered, checkProblems, gradeCheck, scoreChecks } from "./checks";
import type { KnowledgeCheck } from "./course";

function check(id: string): KnowledgeCheck {
  return {
    id,
    prompt: "Where is the constraint?",
    options: [
      {
        id: "a",
        label: "The gateway",
        correct: true,
        why: "It is at its CPU limit while the backend is idle.",
      },
      {
        id: "b",
        label: "The application tier",
        correct: false,
        why: "It is at 21% CPU; a tier that is not working cannot be overloaded.",
      },
    ],
    takeaway: "Read utilisation at every tier before naming a cause.",
  };
}

const checks = [check("one"), check("two"), check("three"), check("four")];

describe("grading", () => {
  it("marks the correct option correct", () => {
    expect(gradeCheck(check("one"), "a")).toEqual({
      checkId: "one",
      chosenOptionId: "a",
      correct: true,
    });
  });

  it("marks an unknown option wrong rather than throwing", () => {
    expect(gradeCheck(check("one"), "nonsense").correct).toBe(false);
  });
});

describe("scoring", () => {
  it("is null before anything is answered", () => {
    expect(scoreChecks(checks, {})).toBeNull();
  });

  it("scores only the checks that were answered", () => {
    // One right of one answered is 100%, even with three unanswered. An untaken question is not a
    // wrong answer, and the completion requirement is what covers "you must answer them all".
    expect(scoreChecks(checks, { one: "a" })).toBe(100);
    expect(scoreChecks(checks, { one: "b" })).toBe(0);
  });

  it("rounds to a whole percent", () => {
    expect(
      scoreChecks(checks, { one: "a", two: "a", three: "a", four: "b" }),
    ).toBe(75);
    expect(
      scoreChecks(checks.slice(0, 3), { one: "a", two: "a", three: "b" }),
    ).toBe(67);
  });

  it("knows when every check has an answer", () => {
    expect(allAnswered(checks, { one: "a" })).toBe(false);
    expect(
      allAnswered(checks, { one: "a", two: "a", three: "a", four: "a" }),
    ).toBe(true);
  });

  it("treats an empty set as unanswered rather than complete", () => {
    expect(allAnswered([], {})).toBe(false);
  });
});

describe("content integrity rules", () => {
  it("accepts a well-formed check", () => {
    expect(checkProblems(check("ok"))).toEqual([]);
  });

  it("rejects a check with no correct option", () => {
    const broken = check("broken");
    broken.options[0].correct = false;
    expect(checkProblems(broken).join()).toContain("0 correct options");
  });

  it("rejects a check with more than one correct option", () => {
    const broken = check("broken");
    broken.options[1].correct = true;
    expect(checkProblems(broken).join()).toContain("2 correct options");
  });

  it("rejects an option that does not explain itself", () => {
    const broken = check("broken");
    broken.options[1].why = "";
    expect(checkProblems(broken).join()).toContain("explain itself");
  });

  it("rejects a check with a single option", () => {
    const broken = check("broken");
    broken.options = [broken.options[0]];
    expect(checkProblems(broken).join()).toContain("two options");
  });

  it("rejects a check with no takeaway", () => {
    const broken = check("broken");
    broken.takeaway = "   ";
    expect(checkProblems(broken).join()).toContain("takeaway");
  });
});
