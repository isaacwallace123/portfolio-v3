/** The width of a row's bar as a share of the fastest time on the same board: the leader fills it,
 *  everyone else reads as a fraction of the leader without anyone doing the arithmetic.
 *
 *  Floored at 14% so a distant time is still a visible mark rather than an empty track. */
export function share(ms: number, fastest: number): number {
  if (!ms || !fastest) return 100;
  return Math.max(14, Math.min(100, Math.round((fastest / ms) * 100)));
}
