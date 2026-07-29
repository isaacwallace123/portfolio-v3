/**
 * Formatting shared by every surface that shows a recorded time — the drill panel, the workbench
 * HUD and the ranked board all print the same clock, so they read it from one place.
 */

/** mm:ss, floored at zero — drill elapsed times, par times and recorded results. */
export function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** A recorded time, or an em dash when nobody has set one yet. */
export function clockOrDash(ms: number | null | undefined) {
  return ms && ms > 0 ? clock(ms) : "—";
}
