/**
 * adherence.pairing — which punched break/lunch belongs to which scheduled one.
 *
 * Pairing is by START-TIME PROXIMITY, not by position. Positional pairing (first
 * scheduled ↔ first punched) shifts every later segment by one as soon as an
 * agent skips an earlier break, so the miss lands on the last break of the day
 * and the skipped one reads as taken hours late.
 *
 * Globally greedy: every (scheduled, punched) pair is ranked by the gap between
 * their starts and the closest pairs are claimed first, each side used once. A
 * scheduled segment left unclaimed is the miss; a punch left unclaimed is an
 * extra, unscheduled break (not scored — there is no plan to compare it to).
 */
export interface Timed {
  startSec: number;
}

/** Punch paired to each scheduled segment, indexed like `scheduled`; undefined = no punch. */
export function pairByNearestStart<A extends Timed>(scheduled: Timed[], actual: A[]): Array<A | undefined> {
  const candidates: Array<{ s: number; a: number; gap: number }> = [];
  scheduled.forEach((sched, s) => {
    actual.forEach((act, a) => candidates.push({ s, a, gap: Math.abs(act.startSec - sched.startSec) }));
  });
  // Ties break on schedule order, then punch order, so the result is deterministic.
  candidates.sort((x, y) => x.gap - y.gap || x.s - y.s || x.a - y.a);

  const paired: Array<A | undefined> = scheduled.map(() => undefined);
  const actUsed = actual.map(() => false);
  for (const c of candidates) {
    if (paired[c.s] !== undefined || actUsed[c.a]) continue;
    paired[c.s] = actual[c.a];
    actUsed[c.a] = true;
  }
  return paired;
}
