export const RANKED_LAUNCH_RECONNECT_MS = 2_000;
const RANKED_LAUNCH_MAX_BACKOFF_MS = 15_000;

/**
 * How long to wait before reopening a launch stream that dropped.
 *
 * A launch is driven server-side now, so a broken connection costs a viewer rather than progress —
 * the launch keeps advancing and the reconnect resumes onto whatever it reached. That makes backing
 * off cheap, and worth doing: a launch that is failing to stream because the API is unhappy should
 * not become a client hammering it. The cap is what keeps a recovered launch from staying unwatched.
 */
export function rankedLaunchReconnectDelay(failures: number): number {
  const safeFailures = Math.max(0, Math.min(10, Math.floor(failures)));
  return Math.min(
    RANKED_LAUNCH_MAX_BACKOFF_MS,
    RANKED_LAUNCH_RECONNECT_MS * 2 ** safeFailures,
  );
}
