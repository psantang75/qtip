/**
 * punchProvider — the ACTUALS side of attendance, the mirror of
 * scheduleProvider's PLAN. It reads punch_raw and answers one question per
 * scheduled day: when did this person actually arrive and leave?
 *
 * punch_raw stores SEGMENTS, not events: each row spans two punch events, with
 * punch_type_in naming the event that opened it and punch_type_out the one that
 * closed it. So a normal day is Clock In→Begin Break, End Break→Begin Meal,
 * End Meal→Clock Out. Arrival is therefore the earliest arrival-type punch_in_at
 * and departure the latest departure-type punch_out_at — see ARRIVAL_TYPES.
 *
 * WHY punches are matched to the SHIFT WINDOW and not to DATE(punch_in_at):
 * a shift that crosses midnight has its Clock Out on the following calendar day,
 * and date grouping would report the missing punch as a full-day absence — a
 * silent, expensive wrong answer. Assigning each punch to the nearest shift
 * anchor costs the same and cannot break that way. No overnight shifts exist
 * today; this is here so the first one does not create an incident.
 */
import prisma from '../../config/prisma';
import { fmtLocal } from '../scheduling/schedule.dates';

/** A scheduled day to find actuals for. start/end are wall-clock instants. */
export interface PunchWindow {
  userId: number;
  dateStr: string;
  start: Date;
  end: Date;
}

export interface PunchDay {
  firstPunchAt: Date | null;
  lastPunchAt: Date | null;
}

/**
 * How far a punch may sit from a shift anchor and still belong to it. Twelve
 * hours is deliberately generous: someone arriving later than that has not
 * "arrived late", they were absent, and the engine scores it that way.
 */
const MAX_ASSIGN_MS = 12 * 60 * 60 * 1000;

/**
 * The punch types that prove somebody SHOWED UP, and the ones that prove they
 * went home.
 *
 * `Start Non-Work` / `End Non-Work` belong here alongside Clock In / Clock Out.
 * Non-Work is on-the-clock time in a non-productive state — training, a meeting,
 * a system outage — not absence. Recognising only Clock In produced twelve
 * false full-day absences across six of thirteen people in the current data,
 * every one of them a person on the clock 12:00-20:00 for a 12:00 or 12:30
 * shift. A false absence costs a full point and feeds the separation ladder, so
 * the asymmetry matters: missing a real absence is recoverable, inventing one
 * is not.
 *
 * Break and Meal events are deliberately excluded. They prove presence but not
 * arrival or departure, and the shift already accounts for unpaid breaks.
 */
const ARRIVAL_TYPES = new Set(['Clock In', 'Start Non-Work']);
const DEPARTURE_TYPES = new Set(['Clock Out', 'End Non-Work']);

const key = (userId: number, dateStr: string) => `${userId}:${dateStr}`;

/** The span of the punch feed for one person. */
export interface UserPunchBounds {
  first: string;
  last: string;
}

/**
 * Punch feed coverage. Attendance may only be computed where the feed actually
 * reaches, or every unimported day becomes a company-wide absence — the single
 * most damaging failure mode this engine has. Real data already contains all
 * three gaps this guards against:
 *
 *   - `datesWithData` is the set of dates SOMEBODY punched on. A scheduled date
 *     missing from it is a feed gap or an unrecorded closure, never an absence.
 *   - `byUser` bounds each person to their own span, so a new hire's pre-hire
 *     scheduled days and a leaver's post-departure ones are not absences.
 *   - a user absent from `byUser` entirely has no punch history at all, so
 *     nothing can be concluded about them and they are not scored.
 */
export interface PunchCoverage {
  minDate: string | null;
  maxDate: string | null;
  datesWithData: Set<string>;
  byUser: Map<number, UserPunchBounds>;
}

export async function getPunchCoverage(): Promise<PunchCoverage> {
  const rows = await prisma.punchRaw.findMany({
    where: { punch_in_at: { not: null } },
    select: { user_id: true, punch_in_at: true },
  });

  const datesWithData = new Set<string>();
  const byUser = new Map<number, UserPunchBounds>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    if (!r.punch_in_at) continue;
    const ds = fmtLocal(r.punch_in_at);
    datesWithData.add(ds);
    if (minDate === null || ds < minDate) minDate = ds;
    if (maxDate === null || ds > maxDate) maxDate = ds;

    const bounds = byUser.get(r.user_id);
    if (!bounds) byUser.set(r.user_id, { first: ds, last: ds });
    else {
      if (ds < bounds.first) bounds.first = ds;
      if (ds > bounds.last) bounds.last = ds;
    }
  }

  return { minDate, maxDate, datesWithData, byUser };
}

/**
 * Latest date the punch feed reaches, as 'YYYY-MM-DD'. A single aggregate, unlike
 * getPunchCoverage which scans the feed — the read API calls this on every request
 * to clamp the as-of date and must not pay for a full scan.
 */
export async function getPunchWatermark(): Promise<string | null> {
  const agg = await prisma.punchRaw.aggregate({ _max: { punch_in_at: true } });
  return agg._max.punch_in_at ? fmtLocal(agg._max.punch_in_at) : null;
}

interface Anchor {
  dateStr: string;
  startMs: number;
  endMs: number;
}

/**
 * Nearest anchor to a punch instant, by distance to the given edge. Returns null
 * when nothing is close enough, which drops stray punches rather than attributing
 * them to a day they do not belong to.
 */
function nearestAnchor(anchors: Anchor[], punchMs: number, edge: 'startMs' | 'endMs'): Anchor | null {
  let best: Anchor | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const a of anchors) {
    const dist = Math.abs(punchMs - a[edge]);
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  }
  return best !== null && bestDist <= MAX_ASSIGN_MS ? best : null;
}

/**
 * Actual arrival and departure per scheduled day, keyed `${userId}:${YYYY-MM-DD}`.
 * One query for the whole range — per-day would be people x 90 round trips.
 *
 * A window with no matched Clock In returns nulls; the engine decides whether
 * that is an absence, which depends on feed coverage it alone can see.
 */
export async function getPunchDays(windows: PunchWindow[]): Promise<Map<string, PunchDay>> {
  const out = new Map<string, PunchDay>();
  if (windows.length === 0) return out;

  const userIds = [...new Set(windows.map((w) => w.userId))];
  const earliest = new Date(Math.min(...windows.map((w) => w.start.getTime())) - MAX_ASSIGN_MS);
  const latest = new Date(Math.max(...windows.map((w) => w.end.getTime())) + MAX_ASSIGN_MS);

  const punches = await prisma.punchRaw.findMany({
    where: {
      user_id: { in: userIds },
      punch_in_at: { gte: earliest, lte: latest },
    },
    select: {
      user_id: true,
      punch_in_at: true,
      punch_out_at: true,
      punch_type_in: true,
      punch_type_out: true,
    },
  });

  const anchorsByUser = new Map<number, Anchor[]>();
  for (const w of windows) {
    const list = anchorsByUser.get(w.userId) ?? [];
    list.push({ dateStr: w.dateStr, startMs: w.start.getTime(), endMs: w.end.getTime() });
    anchorsByUser.set(w.userId, list);
    out.set(key(w.userId, w.dateStr), { firstPunchAt: null, lastPunchAt: null });
  }

  for (const p of punches) {
    const anchors = anchorsByUser.get(p.user_id);
    if (!anchors) continue;

    if (p.punch_type_in && ARRIVAL_TYPES.has(p.punch_type_in) && p.punch_in_at) {
      const a = nearestAnchor(anchors, p.punch_in_at.getTime(), 'startMs');
      if (a) {
        const slot = out.get(key(p.user_id, a.dateStr))!;
        if (slot.firstPunchAt === null || p.punch_in_at < slot.firstPunchAt) {
          slot.firstPunchAt = p.punch_in_at;
        }
      }
    }

    if (p.punch_type_out && DEPARTURE_TYPES.has(p.punch_type_out) && p.punch_out_at) {
      const a = nearestAnchor(anchors, p.punch_out_at.getTime(), 'endMs');
      if (a) {
        const slot = out.get(key(p.user_id, a.dateStr))!;
        if (slot.lastPunchAt === null || p.punch_out_at > slot.lastPunchAt) {
          slot.lastPunchAt = p.punch_out_at;
        }
      }
    }
  }

  return out;
}
