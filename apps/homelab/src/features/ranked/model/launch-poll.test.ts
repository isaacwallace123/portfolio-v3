import { describe, expect, it } from "vitest";
import {
  rankedLaunchReconnectDelay,
  RANKED_LAUNCH_RECONNECT_MS,
} from "./launch-poll";

describe("ranked launch reconnect", () => {
  it("reopens promptly the first time a stream drops", () => {
    expect(rankedLaunchReconnectDelay(0)).toBe(RANKED_LAUNCH_RECONNECT_MS);
  });

  it("backs off exponentially while reconnects keep failing", () => {
    expect(rankedLaunchReconnectDelay(1)).toBe(4_000);
    expect(rankedLaunchReconnectDelay(2)).toBe(8_000);
  });

  it("caps the backoff so a recovered launch is still picked back up", () => {
    expect(rankedLaunchReconnectDelay(3)).toBe(15_000);
    expect(rankedLaunchReconnectDelay(100)).toBe(15_000);
  });
});
