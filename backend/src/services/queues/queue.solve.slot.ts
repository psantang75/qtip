/**
 * Placing people on queues for ONE 15-minute slot. Pure: no Prisma, no dates,
 * no I/O — everything it needs is handed in, which is what makes the rules
 * testable against the awkward cases rather than against a happy path.
 *
 * Order of placement, and why:
 *   0. OVERRIDE — a manager's manual call is a CONSTRAINT, not a late edit.
 *      ASSIGN seats them before anything else; EXCLUDE makes them ineligible.
 *      Applying an exclusion afterwards would punch a hole nobody backfills,
 *      which is the opposite of what "take them off this queue" means.
 *   1. PINNED — somebody who must not move, seated before seats are contested.
 *   2. FLOOR — every queue gets one body before any queue gets its minimum. A
 *      queue with nobody in it does not ring, so a fully-staffed queue next to
 *      an empty one is worse than two thin ones.
 *   3. MINIMUM then TARGET, in fill_priority order — the highest-priority queue
 *      reaches its minimum first, then the next, until the pool is dry.
 *   4. HOME — whoever is still spare goes back to their usual queue.
 *
 * Home is a preference for WHO fills a seat, never a claim on a person. Seating
 * everybody at home first looks like it honours "people sit where they normally
 * sit", but it hands every person to whichever queue they happen to live on
 * before the priority passes run: with one queue per person the pool is then
 * empty, a low-priority queue holds five people against a target of one, and the
 * top-priority queue can never be brought up to its minimum. Pulling from a
 * lower-priority queue to a higher one is the whole point of the module, so
 * seats are allocated by priority and home only decides who takes them.
 *
 * CONTINUITY is what makes one person cover a whole lunch instead of the cover
 * changing every quarter hour. Slots are solved in order and each one is told
 * who held each queue in the slot before it. That preference sits BELOW home,
 * which is what stops it flapping: while Jamie is away Mitch keeps Inbound slot
 * after slot because nobody else is closer, and the moment Jamie is back she
 * outranks him on home and he is released to his own queue.
 */
import { covers, overlapMinutes } from './queue.availability';
import type {
  CoverageLevel, FillStrategy, Interval, QueueSlot, QueueTargets, SeatReason, SlotAssignment,
} from './queue.types';

export interface QueueRow {
  queueId: number;
  queueName: string;
  color: string;
  fillPriority: number;
  sortOrder: number;
  base: QueueTargets;
  windows: Array<{ startMin: number; endMin: number } & QueueTargets>;
}

export interface Membership {
  queueId: number;
  isHome: boolean;
  personPriority: number;
  isPinned: boolean;
}

export interface Person {
  userId: number;
  username: string;
  intervals: Interval[];
  memberships: Map<number, Membership>;
  /** The queue this person is pinned to, when any. */
  pinnedTo: number | null;
  /**
   * Stable position in the day's rotation. Only round-robin reads it, to break
   * an exact tie on cover-minutes without always landing on the same name.
   */
  rotationRank: number;
}

export interface PolicyRules {
  max_queues_per_person: number;
  require_min_one_per_queue: boolean;
  respect_pins: boolean;
  fill_strategy: FillStrategy;
}

export interface ActiveOverride {
  userId: number;
  queueId: number;
  action: 'ASSIGN' | 'EXCLUDE';
}

export interface SlotContext {
  /** For each person, the queues they held in the previous slot. */
  previous: Map<number, Set<number>>;
  /** Minutes each person has already spent covering a queue that is not home. */
  coverMinutes: Map<number, number>;
}

export interface SlotPlacement {
  assignments: SlotAssignment[];
  /** Queues nobody eligible could staff, so auto-move is paused for them. */
  suspended: Set<number>;
}

/** A queue's numbers for a slot: its window if one contains the slot's start. */
export function targetsFor(queue: QueueRow, slot: Interval): QueueTargets {
  const w = queue.windows.find((x) => slot.startMin >= x.startMin && slot.startMin < x.endMin);
  return w ? { min: w.min, target: w.target, max: w.max } : queue.base;
}

export function gradeLevel(trough: number, t: QueueTargets): CoverageLevel {
  if (trough <= 0) return 'none';
  if (trough >= t.target) return 'green';
  if (trough >= t.min) return 'yellow';
  return 'red';
}

export function solveSlot(
  slot: QueueSlot,
  queues: QueueRow[],
  available: Person[],
  policy: PolicyRules,
  overrides: ActiveOverride[],
  ctx: SlotContext,
): SlotPlacement {
  const byId = new Map(available.map((p) => [p.userId, p]));

  const excluded = new Set<string>();
  for (const o of overrides) {
    if (o.action === 'EXCLUDE') excluded.add(`${o.userId}:${o.queueId}`);
  }

  const seats = new Map<number, SlotAssignment[]>(queues.map((q) => [q.queueId, []]));
  const seatCount = new Map<number, number>(available.map((p) => [p.userId, 0]));
  const suspended = new Set<number>();

  /**
   * Which internal pass placed somebody matters far less to a supervisor than
   * whether this is where they normally sit. Anyone landing on their own home
   * queue reads as HOME whatever brought them there, so COVER is left to mean
   * the one thing worth spotting: this person was pulled off their usual queue.
   */
  const seat = (queueId: number, person: Person, forced?: 'OVERRIDE' | 'PINNED'): void => {
    const isHome = person.memberships.get(queueId)?.isHome ?? false;
    const reason: SeatReason = forced ?? (isHome ? 'HOME' : 'COVER');
    seats.get(queueId)!.push({
      userId: person.userId,
      queueId,
      reason,
      fullSlot: covers(person.intervals, slot),
    });
    seatCount.set(person.userId, (seatCount.get(person.userId) ?? 0) + 1);
  };

  const eligible = (queueId: number, person: Person): boolean => {
    if (excluded.has(`${person.userId}:${queueId}`)) return false;
    if (seats.get(queueId)!.some((s) => s.userId === person.userId)) return false;
    if ((seatCount.get(person.userId) ?? 0) >= policy.max_queues_per_person) return false;
    if (policy.respect_pins && person.pinnedTo !== null && person.pinnedTo !== queueId) return false;
    return person.memberships.has(queueId);
  };

  /** Who gets the seat when several people could take it. */
  const tiebreak = (a: Person, b: Person, queueId: number): number => {
    if (policy.fill_strategy === 'ROUND_ROBIN') {
      return (ctx.coverMinutes.get(a.userId) ?? 0) - (ctx.coverMinutes.get(b.userId) ?? 0)
        || a.rotationRank - b.rotationRank;
    }
    return a.memberships.get(queueId)!.personPriority - b.memberships.get(queueId)!.personPriority;
  };

  const held = (person: Person, queueId: number): boolean =>
    ctx.previous.get(person.userId)?.has(queueId) ?? false;

  /**
   * Best remaining candidate for a queue: somebody who calls it home, then
   * whoever was already covering it, then the department's chosen tiebreak,
   * then name so the answer never depends on row order.
   */
  const pull = (queueId: number): Person | null => {
    const candidates = available
      .filter((p) => eligible(queueId, p))
      .sort((a, b) =>
        Number(b.memberships.get(queueId)!.isHome) - Number(a.memberships.get(queueId)!.isHome)
        || Number(held(b, queueId)) - Number(held(a, queueId))
        || tiebreak(a, b, queueId)
        || a.username.localeCompare(b.username));
    return candidates[0] ?? null;
  };

  const fillTo = (queueId: number, ceiling: number): void => {
    while (seats.get(queueId)!.length < ceiling) {
      const person = pull(queueId);
      if (!person) break;
      seat(queueId, person);
    }
  };

  // 0. A manager's ASSIGN is honoured before the rules run, so the passes below
  //    fill around it instead of competing with it.
  for (const o of overrides) {
    if (o.action !== 'ASSIGN') continue;
    const person = byId.get(o.userId);
    if (!person || !seats.has(o.queueId)) continue;
    if (seats.get(o.queueId)!.some((s) => s.userId === o.userId)) continue;
    seat(o.queueId, person, 'OVERRIDE');
  }

  // 1. Pinned people, before any seat is contested. A department that has turned
  //    pins off ignores them completely — a pin that no longer holds somebody in
  //    place must not still be what puts them there.
  if (policy.respect_pins) {
    for (const person of available) {
      const queueId = person.pinnedTo;
      if (queueId === null || !seats.has(queueId)) continue;
      if (!eligible(queueId, person)) continue;
      seat(queueId, person, 'PINNED');
    }
  }

  // 2. Floor: one body in every queue before any queue is filled to its minimum.
  if (policy.require_min_one_per_queue) {
    for (const q of queues) {
      if (seats.get(q.queueId)!.length > 0) continue;
      const person = pull(q.queueId);
      if (person) seat(q.queueId, person);
      else suspended.add(q.queueId);
    }
  }

  // 3. Fill to minimum, then to target, highest-priority queue first. This is
  //    where somebody spare on a low-priority queue gets pulled up to a high one.
  for (const pass of ['MIN', 'TARGET'] as const) {
    for (const q of queues) {
      if (suspended.has(q.queueId)) continue;
      const t = targetsFor(q, slot);
      const ceiling = pass === 'MIN' ? t.min : t.target;
      fillTo(q.queueId, t.max == null ? ceiling : Math.min(ceiling, t.max));
    }
  }

  // 4. Anybody still spare goes back to their usual queue rather than sitting
  //    idle, capped by max so a queue past its target does not overflow.
  for (const person of available) {
    if ((seatCount.get(person.userId) ?? 0) > 0) continue;
    for (const m of person.memberships.values()) {
      if (!m.isHome || !seats.has(m.queueId)) continue;
      if (suspended.has(m.queueId) || !eligible(m.queueId, person)) continue;
      const max = targetsFor(queues.find((q) => q.queueId === m.queueId)!, slot).max;
      if (max != null && seats.get(m.queueId)!.length >= max) continue;
      seat(m.queueId, person);
      break;
    }
  }

  return { assignments: queues.flatMap((q) => seats.get(q.queueId)!), suspended };
}

/** People with any coverage minutes inside the slot. */
export function availableIn(people: Person[], slot: QueueSlot): Person[] {
  return people.filter((p) => overlapMinutes(p.intervals, slot) > 0);
}
