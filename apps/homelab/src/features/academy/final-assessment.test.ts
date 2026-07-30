import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Wiring rules for the final-assessment surface.
//
// The behaviour these guard is not a pure function — it is "the course sends you to the overview
// rather than into a provisioning screen", "the launch is still the same practice drill", and "the
// page does not quietly grow a Ranked import". Those are properties of the source, so they are
// checked by reading it, the same way `isolation.test.ts` checks the slice boundary.

const SRC = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) =>
  readFileSync(path.join(SRC, relative), "utf8");

const ROUTE = "app/practice/assessment/page.tsx";
const PAGE = "features/academy/ui/FinalAssessment.tsx";
const COURSE_PATH = "features/academy/ui/CoursePath.tsx";
const CAPSTONE = "features/academy/ui/AcademyCapstone.tsx";
const MODEL = "features/academy/model/assessment.ts";

describe("the final-assessment route", () => {
  it("exists at /practice/assessment", () => {
    expect(existsSync(path.join(SRC, ROUTE))).toBe(true);
  });

  it("renders the Academy's own page against the real course", () => {
    const source = read(ROUTE);
    expect(source).toContain("FinalAssessment");
    expect(source).toContain("ACADEMY_COURSE");
    expect(source).toContain('canonical: "/practice/assessment"');
  });

  it("is what the course path's final CTA opens", () => {
    const source = read(COURSE_PATH);
    expect(source).toContain("ASSESSMENT_HREF");
    // The course outline must not jump the overview and launch the drill directly.
    expect(source).not.toContain("?assessment=1");
  });
});

describe("the assessment launch", () => {
  it("still runs the existing double-fault scenario", () => {
    expect(read(MODEL)).toContain("?assessment=1");
    expect(read("features/academy/content/production-operations.ts")).toContain(
      'finalAssessmentDrillId: "double-fault"',
    );
  });

  it("reuses the one cluster interface rather than building a second", () => {
    // The overview page renders no cluster of its own: `AcademyCapstone` is still the only thing
    // in the slice that mounts the workbench, and it is still the only drill state machine.
    expect(read(PAGE)).not.toContain("cluster-workbench");
    expect(read(PAGE)).not.toContain("live-client");
    expect(read(CAPSTONE)).toContain("@/widgets/cluster-workbench");
  });

  it("hands the drill all seven domains and returns to the overview", () => {
    const source = read(CAPSTONE);
    expect(source).toContain("assessmentSkills(course)");
    expect(source).toContain("ASSESSMENT_HREF");
    // Assessment mode is still a presentation over a practice drill, never a ranked one.
    expect(source).toContain(
      'presentation: assessment ? "assessment" : "guided"',
    );
  });

  it("never offers a launch control that cannot work", () => {
    const source = read(PAGE);
    // The unlocked branch is the only one that renders the primary link to the drill.
    expect(source).toContain("standing.unlocked ? (");
    expect(source).not.toMatch(/disabled=\{!standing\.unlocked/);
  });
});

describe("the assessment stays practice", () => {
  const surfaces = [ROUTE, PAGE, MODEL, COURSE_PATH, CAPSTONE];

  it("imports nothing from Ranked and calls no ranked route", () => {
    for (const file of surfaces) {
      const source = read(file);
      expect(source, file).not.toMatch(/from\s+["']@\/features\/ranked/);
      expect(source, file).not.toMatch(/from\s+["'].*\/ranked\//);
      expect(source, file).not.toContain("/api/live/ranked");
      expect(source, file).not.toContain("/ranked");
    }
  });

  it("has no rating, ELO or leaderboard concept of its own", () => {
    for (const file of surfaces) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /\b(elo|rating|rank)(Rating|Delta|Points|Change)?\s*[:=]/i,
      );
      expect(source, file).not.toContain("leaderboard");
    }
  });

  it("computes no score of its own from the run", () => {
    // Judging happens on the cluster, server-side. Anything here that looked like scoring would
    // be a second, quieter answer to the same question.
    for (const file of [PAGE, MODEL]) {
      const source = read(file);
      expect(source, file).not.toMatch(/\bpassed\s*[:=]/);
      expect(source, file).not.toMatch(/\bgrade[A-Z(]/);
    }
  });
});

describe("the page's claims", () => {
  it("keeps the certificate-of-completion disclaimer intact", () => {
    const source = read(PAGE);
    expect(source).toContain("HomeOps Certificate of Completion");
    expect(source).toMatch(/not an industry/);
    expect(source).toMatch(/not endorsed by/);
    expect(source).toContain("CNCF");
  });

  it("claims no accreditation, proctoring or external recognition", () => {
    const source = `${read(PAGE)} ${read(MODEL)}`;
    expect(source).not.toMatch(/\baccredited by (?!AWS|,)/i);
    expect(source).not.toMatch(/proctor/i);
    expect(source).not.toMatch(
      /industry[- ]recognised|industry[- ]recognized/i,
    );
    expect(source).not.toMatch(/exam(ination)?\s+board|invigilat/i);
  });

  it("routes a completed assessment at the certificate requirements", () => {
    expect(read(PAGE)).toContain("/practice/certificate");
  });
});

describe("motion and transparency preferences", () => {
  it("gates the blueprint animation on the Academy's own motion hook", () => {
    const source = read(PAGE);
    expect(source).toContain("useAnimationAllowed");
    expect(source).toContain("data-animate={animate}");
  });

  it("switches the animation off for both reduced-motion signals", () => {
    const css = read("features/academy/ui/academy.module.css");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.blueprint/,
    );
    // Prettier may wrap a long selector across lines, so the site-toggle rule is matched rather
    // than compared literally.
    expect(css).toMatch(
      /:global\(html\[data-reduce-motion\]\)\s+\.blueprint\[data-animate="true"\]\s+\.blueprintRow\s*\{\s*animation: none;/,
    );
  });

  it("makes the new surfaces opaque under reduced transparency", () => {
    const css = read("features/academy/ui/academy.module.css");
    for (const selector of [
      ".assessCard",
      ".assessCertificate",
      ".rule",
      ".blueprintRow",
    ])
      expect(css).toContain(
        `:global(html[data-reduce-transparency]) ${selector}`,
      );
  });
});
