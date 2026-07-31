import { describe, expect, it } from "vitest";
import { COMMAND_GROUPS, helpLines, parseConsoleCommand } from "./console";

describe("the operator console vocabulary", () => {
  it("keeps reads local to the inspect path and hands everything else to the server", () => {
    expect(parseConsoleCommand("inspect metrics checkout")).toEqual({
      kind: "inspect",
      query: "inspect metrics checkout",
    });
    expect(parseConsoleCommand("trace latest")).toEqual({
      kind: "inspect",
      query: "trace latest",
    });
    expect(parseConsoleCommand("history")).toEqual({
      kind: "inspect",
      query: "history",
    });
    // Not an allowlist. The server owns that, and a client-side guess at it would either refuse a
    // command the platform accepts or accept one it does not.
    expect(parseConsoleCommand("scale checkout 4")).toEqual({
      kind: "remote",
      command: "scale checkout 4",
    });
    expect(parseConsoleCommand("wat")).toEqual({
      kind: "remote",
      command: "wat",
    });
  });

  it("normalises case and runs of whitespace before routing", () => {
    expect(parseConsoleCommand("  SCALE   Checkout   4 ")).toEqual({
      kind: "remote",
      command: "scale checkout 4",
    });
  });

  it("treats an empty line as a request for help rather than a command", () => {
    expect(parseConsoleCommand("   ")).toEqual({ kind: "help", topic: null });
    expect(parseConsoleCommand("help")).toEqual({ kind: "help", topic: null });
  });

  it("narrows help to a known group and ignores an unknown one", () => {
    expect(parseConsoleCommand("help operate")).toEqual({
      kind: "help",
      topic: "operate",
    });
    expect(parseConsoleCommand("help nonsense")).toEqual({
      kind: "help",
      topic: null,
    });
  });

  it("explains every command rather than listing its syntax", () => {
    const lines = helpLines(null).join("\n");
    for (const group of COMMAND_GROUPS)
      for (const command of group.commands) {
        expect(lines).toContain(command.usage);
        expect(lines).toContain(command.effect);
      }
    // Reads and changes are separated, because that distinction is the console's one lesson.
    expect(lines).toContain("INVESTIGATE");
    expect(lines).toContain("OPERATE");
  });

  it("shows only the requested group when help is narrowed", () => {
    const lines = helpLines("operate").join("\n");
    expect(lines).toContain("scale checkout <1-6>");
    expect(lines).not.toContain("INVESTIGATE");
    expect(lines).not.toContain("trace latest");
  });

  it("documents every operate command the ranked allowlist accepts", () => {
    // Drift here is how a course ends up teaching a verb the platform refuses. The API side of
    // this pairing is covered by RankedScenarioGeneratorTests.EveryResolvingMoveHasAnEquivalent-
    // ConsoleCommand, which parses each documented move through the real allowlist.
    const operate = COMMAND_GROUPS.find((group) => group.id === "operate");
    const documented = operate?.commands.map((command) => command.usage) ?? [];
    for (const expected of [
      "scale checkout <1-6>",
      "scale gateway <1-3>",
      "shift canary <0-3>",
      "enable cache | disable cache",
      "rollback checkout",
      "recover catalogue",
      "set database connections <1-16>",
      "restore database network",
      "drain apps | drain infra",
      "restart checkout",
    ])
      expect(documented).toContain(expected);
  });
});
