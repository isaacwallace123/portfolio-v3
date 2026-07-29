/** Compact relative age of an ISO timestamp: 42s, 7m, 2h. */
export function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** Add or remove a value, returning a new Set — the shape React state wants. */
export function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * A running container always uses some memory, so a zero reading means metrics-server has not
 * sampled this pod yet rather than that the pod is doing nothing. Saying "0m 0Mi" for a healthy
 * replica reads as broken; saying so explicitly does not.
 */
export function sampled(memoryMiB: number): boolean {
  return memoryMiB > 0;
}
