export const RANKED_LAUNCH_POLL_MS = 1_500;
const RANKED_LAUNCH_MAX_BACKOFF_MS = 15_000;

/** Back off every failed launch advance without ever leaving the UI permanently latched. */
export function rankedLaunchPollDelay(failures: number): number {
  const safeFailures = Math.max(0, Math.min(10, Math.floor(failures)));
  return Math.min(
    RANKED_LAUNCH_MAX_BACKOFF_MS,
    RANKED_LAUNCH_POLL_MS * 2 ** safeFailures,
  );
}
