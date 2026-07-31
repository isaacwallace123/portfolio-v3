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
    expect(result).toContain("Operational quality");
    expect(result).toContain("SLO health");
    expect(result).toContain("Official time is excluded from this score.");
  });

  it("uses the lobby until a ranked incident becomes active", () => {
    const workbench = read("widgets/cluster-workbench/ClusterWorkbench.tsx");
    expect(workbench).toContain(
      'surface === "ranked" && (!run || run.drillId.length === 0)',
    );
    expect(workbench).toContain("<RankedHub");
  });

  it("drives the owner-scoped server launch instead of starting a drill", () => {
    const workbench = read("widgets/cluster-workbench/ClusterWorkbench.tsx");
    const launch = read("features/ranked/model/useRankedLaunch.ts");
    const client = read("shared/api/live-client.ts");
    const route = read("app/api/live/ranked/launch/route.ts");
    const hub = read("widgets/leaderboard/ui/RankedHub.tsx");
    expect(workbench).toContain("useRankedLaunch");
    expect(workbench).toContain("<RankedLaunchScreen");
    expect(launch).toContain("advanceRankedLaunch");
    expect(launch).toContain("fetchRankedLaunch");
    expect(launch).toContain("cancelRankedLaunch");
    expect(route).toContain('"/v1/ranked/launch"');
    expect(route).toContain("g.caller.owner");
    expect(route).toContain('? "provision"');
    expect(route).toContain('? "cancel"');
    expect(route).toContain(': "launch"');
    expect(route).not.toContain("runId");
    expect(client).toContain("AbortSignal.timeout(15_000)");
    expect(hub).toContain("Start ranked");
    expect(hub).not.toContain("startDrill(");
  });

  it("renders launch time separately while match time remains paused", () => {
    const screen = read("features/ranked/ui/RankedLaunchScreen.tsx");
    expect(screen).toContain("launchElapsedSeconds");
    expect(screen).toContain("Match clock");
    expect(screen).toContain("00:00 · paused");
    expect(screen).toContain("launch.checks.map");
  });

  it("uses floating arena tools instead of a permanent ranked inspector", () => {
    const arena = read("features/ranked/ui/RankedArena.tsx");
    const workbench = read("widgets/cluster-workbench/ClusterWorkbench.tsx");
    expect(arena).toContain("toolDock");
    expect(arena).toContain("floatingPanel");
    expect(arena).toContain('{ id: "console", label: "Console"');
    expect(arena).toContain('{ id: "metrics", label: "Metrics"');
    expect(arena).toContain("aria-expanded={activeTool === id}");
    expect(arena).toContain("aria-controls={panelId}");
    expect(arena).toContain("onKeyDown={closeOnEscape}");
    expect(arena).toContain("toolButtons.current[closing]?.focus()");
    expect(arena).toContain('"withheld"');
    expect(workbench).toContain('surface !== "ranked" &&');
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
