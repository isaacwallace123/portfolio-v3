import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelRankedLaunch,
  LiveError,
  streamRankedLaunch,
  type RankedLaunchView,
} from "./live-client";

const launch = {
  launchId: "launch",
  runId: "run-hl-0123456789abcdef",
  phase: "provisioning",
  launchElapsedSeconds: 3,
  terminal: false,
} as RankedLaunchView;

/** A response whose body delivers `chunks` in order, so frame splitting is exercised for real. */
function eventStream(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ranked launch client", () => {
  it("marks only explicit user starts as provisioning requests", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(eventStream([`event: end\ndata: {}\n\n`]));
    vi.stubGlobal("fetch", fetch);

    await streamRankedLaunch({
      retry: true,
      start: true,
      signal: new AbortController().signal,
      onLaunch: () => {},
      onElapsed: () => {},
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/live/ranked/launch/stream?retry=true&start=true",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("omits both flags when resuming a launch already in progress", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(eventStream([`event: end\ndata: {}\n\n`]));
    vi.stubGlobal("fetch", fetch);

    await streamRankedLaunch({
      signal: new AbortController().signal,
      onLaunch: () => {},
      onElapsed: () => {},
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/live/ranked/launch/stream",
      expect.anything(),
    );
  });

  it("reassembles frames that arrive split across chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          eventStream([
            `event: launch\ndata: ${JSON.stringify({ launch }).slice(0, 20)}`,
            `${JSON.stringify({ launch }).slice(20)}\n\nevent: tick\ndata: {"launchElapsedSeconds":9}\n\n`,
          ]),
        ),
    );

    const views: RankedLaunchView[] = [];
    const ticks: number[] = [];
    await streamRankedLaunch({
      signal: new AbortController().signal,
      onLaunch: (view) => views.push(view),
      onElapsed: (seconds) => ticks.push(seconds),
    });

    expect(views).toEqual([launch]);
    expect(ticks).toEqual([9]);
  });

  it("stops reading at the end frame without consuming what follows", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          eventStream([
            `event: end\ndata: {}\n\nevent: tick\ndata: {"launchElapsedSeconds":99}\n\n`,
          ]),
        ),
    );

    const ticks: number[] = [];
    await streamRankedLaunch({
      signal: new AbortController().signal,
      onLaunch: () => {},
      onElapsed: (seconds) => ticks.push(seconds),
    });

    expect(ticks).toEqual([]);
  });

  it("surfaces a refused handshake as the status the launch answered with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "No ranked launch is in progress." }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      streamRankedLaunch({
        signal: new AbortController().signal,
        onLaunch: () => {},
        onElapsed: () => {},
      }),
    ).rejects.toMatchObject({
      status: 404,
      message: "No ranked launch is in progress.",
    });
    await expect(
      streamRankedLaunch({
        signal: new AbortController().signal,
        onLaunch: () => {},
        onElapsed: () => {},
      }),
    ).rejects.toBeInstanceOf(LiveError);
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
