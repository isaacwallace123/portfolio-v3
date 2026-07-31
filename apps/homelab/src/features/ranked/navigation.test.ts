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
    expect(launch).toContain("streamRankedLaunch");
    expect(launch).toContain("fetchRankedLaunch");
    expect(launch).toContain("cancelRankedLaunch");
    expect(route).toContain('"/v1/ranked/launch"');
    expect(route).toContain("g.caller.owner");
    expect(route).toContain('? "read"');
    expect(route).toContain('"cancel"');
    expect(route).not.toContain("runId");
    expect(client).toContain("AbortSignal.timeout(15_000)");
    expect(hub).toContain("Start ranked");
    expect(hub).not.toContain("startDrill(");
  });

  it("advances the launch over one stream rather than a client-side timer", () => {
    const launch = read("features/ranked/model/useRankedLaunch.ts");
    const stream = read("app/api/live/ranked/launch/stream/route.ts");
    const route = read("app/api/live/ranked/launch/route.ts");
    // The single-step POST was what made the browser the drive loop. Its absence is the invariant.
    expect(route).not.toContain("export async function POST");
    expect(launch).not.toContain("setTimeout(() => void advance");
    // A start can provision a cluster, so it keeps the expensive budget; a resume does not.
    expect(stream).toContain('start ? "provision" : "stream"');
    expect(stream).toContain("/v1/ranked/launch/stream");
    // Passed through untouched: reading the body here would buffer the launch into one late blob.
    expect(stream).toContain("new Response(res.body");
    expect(stream).toContain('"X-Accel-Buffering": "no"');
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
    expect(arena).toContain("aria-expanded={panelOpen && activeTool === id}");
    expect(arena).toContain("aria-controls={panelId}");
    expect(arena).toContain("onKeyDown={closeOnEscape}");
    expect(arena).toContain("toolButtons.current[activeTool]?.focus()");
    expect(arena).toContain('"withheld"');
    expect(workbench).toContain('surface !== "ranked" &&');
  });

  it("opens on the console, and keeps its transcript across a close", () => {
    const arena = read("features/ranked/ui/RankedArena.tsx");
    // The console is the only way to change anything on this surface — the practice controls
    // column is not rendered here — so the operate loop cannot start behind a closed panel.
    expect(arena).toContain('useState<RankedTool>("console")');
    // Hidden, not unmounted: closing a panel to look at the graph is not a reason to lose the
    // record of the shift.
    expect(arena).toContain("hidden={!panelOpen}");
    expect(arena).not.toContain("setActiveTool(null)");
  });

  it("plays Ranked and the Academy through one shared operator console", () => {
    const arena = read("features/ranked/ui/RankedArena.tsx");
    const academy = read("features/drill/ui/PracticeDrillPanel.tsx");
    const console_ = read("widgets/operator-console/ui/OperatorConsole.tsx");
    // One component, one vocabulary. A course that taught different words from the ones a rated
    // match accepts would be teaching a dialect.
    expect(arena).toContain("<OperatorConsole");
    expect(academy).toContain("<OperatorConsole");
    expect(console_).toContain("parseConsoleCommand");
    // The split is server-side: audited for a rated attempt, free for a learner.
    expect(arena).toContain("rankedCommand(");
    expect(academy).toContain("practiceCommand(");
  });

  it("says why the control plane refused, in the console that asked", () => {
    const console_ = read("widgets/operator-console/ui/OperatorConsole.tsx");
    expect(console_).toContain("Refused (${cause.status}): ${cause.message}");
    expect(console_).toContain('"refused"');
  });

  it("drops the launch once the match it produced is over", () => {
    const workbench = read("widgets/cluster-workbench/ClusterWorkbench.tsx");
    const launch = read("features/ranked/model/useRankedLaunch.ts");
    // Without this the hook keeps reporting an active launch after a forfeit, a teardown, or a
    // return to the queue — and the page's fallback for "a launch with no incident on it" is the
    // provisioning screen, so ending a match sent the operator to watch a cluster start up.
    expect(launch).toContain("const clear = useCallback");
    expect(workbench).toContain("const { clear: clearLaunch } = rankedLaunch;");
    expect(workbench).toContain("rankedMatchRun.current = run.runId;");
    expect(workbench).toContain("clearLaunch();");
  });

  it("answers an accepted command with a judged frame, not a bare run", () => {
    const route = read("app/api/live/ranked/[runId]/commands/route.ts");
    // RunView carries no goals; the snapshot handler is where they are judged and attached. Sending
    // the command's own view back emptied the measured objective on every accepted command.
    expect(route).toContain("/v1/runs/${runId}/snapshot");
    expect(route).not.toContain("/v1/runs/${runId}/telemetry");
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
