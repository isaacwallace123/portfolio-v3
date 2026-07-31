import { describe, expect, it } from "vitest";
import { rankedLaunchPollDelay, RANKED_LAUNCH_POLL_MS } from "./launch-poll";

describe("ranked launch polling", () => {
  it("starts at the responsive launch cadence", () => {
    expect(rankedLaunchPollDelay(0)).toBe(RANKED_LAUNCH_POLL_MS);
  });

  it("backs off exponentially after failures", () => {
    expect(rankedLaunchPollDelay(1)).toBe(3_000);
    expect(rankedLaunchPollDelay(2)).toBe(6_000);
    expect(rankedLaunchPollDelay(3)).toBe(12_000);
  });

  it("caps retries so a recovered launch is still observed", () => {
    expect(rankedLaunchPollDelay(4)).toBe(15_000);
    expect(rankedLaunchPollDelay(100)).toBe(15_000);
  });
});
