import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("bounded control request bodies", () => {
  it("accepts only the requested string field", async () => {
    const { readBoundedStringBody } = await import("./guard");
    const valid = await readBoundedStringBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ command: "scale checkout 4" }),
      }),
      "command",
      128,
    );
    expect(valid).toEqual({ ok: true, value: "scale checkout 4" });

    const wrongType = await readBoundedStringBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ command: { patch: "anything" } }),
      }),
      "command",
      128,
    );
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.response.status).toBe(400);
  });

  it("rejects oversized declared and streamed bodies", async () => {
    const { readBoundedStringBody } = await import("./guard");
    const declared = await readBoundedStringBody(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Length": "2048" },
        body: "{}",
      }),
      "command",
      128,
    );
    expect(declared.ok).toBe(false);
    if (!declared.ok) expect(declared.response.status).toBe(413);

    const streamed = await readBoundedStringBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ command: "x".repeat(1500) }),
      }),
      "command",
      128,
    );
    expect(streamed.ok).toBe(false);
    if (!streamed.ok) expect(streamed.response.status).toBe(413);
  });
});
