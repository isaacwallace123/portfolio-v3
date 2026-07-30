import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("liveFetch trusted headers", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.HOMELAB_RUNS_KEY = "trusted-service-key";
    process.env.HOMELAB_API_URL = "https://api.example.test";
  });

  it("does not allow caller headers to replace credentials or verified identity", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { liveFetch } = await import("./live-server");

    const response = await liveFetch(
      "/v1/runs",
      {
        headers: {
          Authorization: "Bearer attacker",
          "X-Owner-Key": "attacker",
          "X-Owner-Name": "Attacker",
          "X-Custom": "kept",
        },
      },
      "verified-owner",
      "Verified Name",
    );

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer trusted-service-key");
    expect(headers.get("x-owner-key")).toBe("verified-owner");
    expect(headers.get("x-owner-name")).toBe("Verified Name");
    expect(headers.get("x-custom")).toBe("kept");
  });
});
