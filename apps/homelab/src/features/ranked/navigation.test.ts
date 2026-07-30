import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) =>
  readFileSync(path.join(SRC, relative), "utf8");

describe("the unified Ranked destination", () => {
  it("keeps one competitive destination in the network navigation", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('{ href: "/ranked", label: "Ranked" }');
    expect(layout).not.toContain(
      '{ href: "/leaderboard", label: "Leaderboard" }',
    );
  });

  it("preserves old leaderboard links with a permanent standings redirect", () => {
    const legacyRoute = read("app/leaderboard/page.tsx");
    expect(legacyRoute).toContain('permanentRedirect("/ranked#standings")');
  });

  it("returns match results to the standings on the same Ranked page", () => {
    const result = read("features/ranked/ui/RankedResult.tsx");
    expect(result).toContain('href="/ranked#standings"');
    expect(result).not.toContain('href="/leaderboard"');
  });

  it("uses the lobby until a ranked incident becomes active", () => {
    const workbench = read("widgets/cluster-workbench/ClusterWorkbench.tsx");
    expect(workbench).toContain(
      'surface === "ranked" && (!run || run.drillId.length === 0)',
    );
    expect(workbench).toContain("<RankedHub");
  });

  it("defaults to one ELO ladder with a secondary time switch", () => {
    const hub = read("widgets/leaderboard/ui/RankedHub.tsx");
    expect(hub).toContain('useState<BoardMode>("elo")');
    expect(hub).toContain("> ELO");
    expect(hub).toContain("> Time");
    expect(hub).toContain("<RatingBoard");
    expect(hub).toContain("<TimeBoard");
    expect(hub).not.toContain("<Podium");
    expect(hub).not.toContain("<BoardTable");
    expect(hub).not.toContain("byDrill");
  });
});
