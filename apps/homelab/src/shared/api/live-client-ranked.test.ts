import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advanceRankedLaunch,
  cancelRankedLaunch,
  type RankedLaunchView,
} from "./live-client";

const launch = {
  launchId: "launch",
  runId: "run-hl-0123456789abcdef",
} as RankedLaunchView;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ranked launch client", () => {
  it("marks only explicit user starts as provisioning requests", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ launch }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await advanceRankedLaunch(true, true);

    expect(fetch).toHaveBeenCalledWith(
      "/api/live/ranked/launch?retry=true&start=true",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("keeps cancellation on its own request path", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ launch }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await cancelRankedLaunch();

    expect(fetch).toHaveBeenCalledWith(
      "/api/live/ranked/launch",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
