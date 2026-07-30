import { describe, expect, it } from "vitest";
import { parseConsoleCommand } from "./console";

describe("ranked console command routing", () => {
  it("keeps investigations local to the real polled snapshot", () => {
    expect(parseConsoleCommand("inspect events --warnings")).toEqual({
      kind: "events",
      warningsOnly: true,
    });
    expect(parseConsoleCommand("trace latest")).toEqual({ kind: "trace" });
  });

  it("normalizes whitespace before sending mutations to the server allowlist", () => {
    expect(parseConsoleCommand("  SCALE   checkout  4 ")).toEqual({
      kind: "remote",
      command: "scale checkout 4",
    });
  });

  it("does not mistake arbitrary text for a client-side inspection", () => {
    expect(parseConsoleCommand("kubectl delete namespace production")).toEqual({
      kind: "remote",
      command: "kubectl delete namespace production",
    });
  });
});
