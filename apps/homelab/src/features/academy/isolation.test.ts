import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Practice and Ranked share the real Kubernetes arena engine and nothing else.
//
// This is an architectural rule rather than a behaviour, so it is checked the way architectural
// rules have to be: by reading the source. Two workstreams are building on one branch, and the
// failure mode this guards against — an Academy import creeping into the ranked slice, or a
// ranked concept leaking into a lesson — is exactly the kind that compiles, passes every other
// test, and is expensive to unpick later.

const SRC = path.resolve(import.meta.dirname, "../..");

function filesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    // Test files are excluded, this one included: a test that forbids a string has to contain
    // that string, and scanning itself would make every rule here fail on its own definition.
    if (/\.test\.tsx?$/.test(entry)) return [];
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, "/");

const academyFiles = [
  ...filesUnder(path.join(SRC, "features/academy")),
  ...filesUnder(path.join(SRC, "app/practice")),
];
const rankedFiles = [
  ...filesUnder(path.join(SRC, "features/ranked")),
  ...filesUnder(path.join(SRC, "app/ranked")),
  ...filesUnder(path.join(SRC, "app/api/live/ranked")),
];

describe("Practice and Ranked isolation", () => {
  it("finds both slices, so a passing suite means something", () => {
    expect(academyFiles.length).toBeGreaterThan(10);
    expect(rankedFiles.length).toBeGreaterThan(0);
  });

  it("never imports Ranked code from the Academy", () => {
    for (const file of academyFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/from\s+["']@\/features\/ranked/);
      expect(source, rel(file)).not.toMatch(/from\s+["'].*\/ranked\//);
    }
  });

  it("never imports Academy code from Ranked", () => {
    for (const file of rankedFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/from\s+["']@\/features\/academy/);
      expect(source, rel(file)).not.toMatch(/from\s+["'].*\/academy/);
    }
  });

  it("never calls a ranked API route from the Academy", () => {
    for (const file of academyFiles)
      expect(read(file), rel(file)).not.toContain("/api/live/ranked");
  });

  it("never starts a drill in ranked mode from the Academy", () => {
    // A practice result must never become a ranked result. The Academy's three presentations —
    // guided, assisted, assessment — are all `practice` on the wire.
    for (const file of academyFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/["']ranked["']\s*\)/);
      expect(source, rel(file)).not.toMatch(/mode:\s*["']ranked["']/);
    }
  });

  it("never writes learning progress from Ranked", () => {
    for (const file of rankedFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toContain("/api/live/learning");
      expect(source, rel(file)).not.toContain("learningUnitId");
    }
  });

  it("has no rating concept of its own", () => {
    // The skill profile is Academy mastery, not a rating: it never goes down and it compares the
    // learner with nobody. Prose saying so is fine and wanted — what must not appear is an actual
    // rating field, which is why this looks for identifiers rather than for the word.
    for (const file of academyFiles) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(
        /\b(elo|rating|rank)(Rating|Delta|Points|Change)?\s*[:=]/i,
      );
      expect(source, rel(file)).not.toMatch(/\.(elo|ratingDelta)\b/i);
    }
  });

  it("introduces no seasonal concepts anywhere in either slice", () => {
    for (const file of [...academyFiles, ...rankedFiles]) {
      const source = read(file);
      expect(source, rel(file)).not.toMatch(/seasonId|SeasonId|currentSeason/);
    }
  });
});

describe("the Academy's honesty rules", () => {
  it("labels every teaching visualisation as an illustration", () => {
    // Lesson diagrams are deterministic examples and capstone numbers are measured. A learner has
    // to be able to tell which is which at a glance, or the first thing the course teaches is that
    // charts on this site may or may not be real.
    const registry = read(path.join(SRC, "features/academy/visuals/index.tsx"));
    expect(registry).toContain("ILLUSTRATIVE_NOTE");
    const uses = registry.match(/ILLUSTRATIVE_NOTE/g) ?? [];
    // Once per exported frame — the static one and the guided one — plus the import.
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  it("never claims an external endorsement on the certificate", () => {
    const certificate = read(
      path.join(SRC, "features/academy/ui/CertificateView.tsx"),
    );
    expect(certificate).toContain("not an industry certification");
    expect(certificate).toMatch(/not endorsed by/);
    expect(certificate).toContain("HomeOps Certificate of Completion");
  });

  it("does not let a lesson invent live telemetry", () => {
    // Content is prose and fixed numbers. If a content file started importing the live client, a
    // lesson could render something that looks measured and is not.
    for (const file of filesUnder(path.join(SRC, "features/academy/content")))
      expect(read(file), rel(file)).not.toContain("shared/api/live-client");
  });
});
