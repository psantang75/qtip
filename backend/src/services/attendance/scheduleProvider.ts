/**
 * scheduleProvider — the read interface the Operations Attendance metric uses to
 * turn punches into Late / Absent / Compliant. This module is the system of
 * record's public face; it scores nothing.
 *
 * Contract (from the attendance plan): getScheduledShift(userId, date) plus a
 * bulk variant, because per-day would be people × 90 queries per page load.
 *
 * PUBLISHED shifts only by default — publishing is what creates attendance
 * denominators, so a stack of DRAFT weeks can never silently mark anyone absent.
 * A caller that scores nothing may opt into drafts with `{ publishedOnly: false }`
 * (queue coverage planning does, to preview a week still being built); every
 * scoring caller must leave the default alone.
 * A full-day excused exception is returned attached to the day; the attendance
 * engine drops such a day from the denominator rather than counting it compliant.
 *
 * DST / wall-clock: start/end are DATETIME (no timezone), so scheduledMinutes is
 * computed from wall-clock components, never by subtracting two instants, or the
 * spring-forward week comes out an hour short.
 */
import prisma from '../../config/prisma';
import { fetchShiftsInRange } from '../scheduling/schedule.shift.service';
import { dateStrFromDate, hmFromDateTime, dateOnlyValue } from '../scheduling/schedule.dates';
import { getCalendarDayTypes } from '../../utils/businessCalendar';

export interface ScheduledSegment {
  activity: string;
  start: string; // 'HH:MM' wall clock
  end: string;
  isPaid: boolean;
  countsAsCoverage: boolean;
}

export interface ScheduledException {
  id: number;
  typeId: number;
  typeKey: string;
  label: string;
  isExcused: boolean;
  isFullDay: boolean;
  affectsArrival: boolean;
  affectsDeparture: boolean;
  start: string | null;
  end: string | null;
}

export interface ScheduledDay {
  shiftId: number;
  start: string | null;
  end: string | null;
  isDayOff: boolean;
  scheduledMinutes: number; // net of unpaid segments
  segments: ScheduledSegment[];
  exceptions: ScheduledException[];
}

const DAY_MINUTES = 24 * 60;

function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Net scheduled minutes: span minus the unpaid minutes that fall INSIDE the span,
 * wall-clock only.
 *
 * Clamping to the span is what keeps compliance from exceeding 100%. Segments can
 * outlive the shift they hang off — shorten a shift and the original lunch stays
 * put — and the current data has three such days, where a shift ending at 16:30
 * still carries a 17:30 lunch. The actuals side can only ever subtract overlap it
 * finds inside the shift window, so deducting the full segment here would make the
 * denominator smaller than the numerator: 100.21% compliant, which is indefensible
 * on a report people are disciplined from.
 *
 * Exported for tests: it is the compliance DENOMINATOR, so it has to agree with
 * the engine's numerator on exactly which unpaid minutes count.
 */
export function netMinutes(start: string | null, end: string | null, segments: ScheduledSegment[]): number {
  if (!start || !end) return 0;

  const spanStart = minutesOf(start);
  // An end at or before the start means the shift crosses midnight. Without the
  // roll the span is negative, scheduled_minutes lands on 0, and the engine skips
  // the day entirely for having no denominator — a silent hole rather than a
  // visible wrong answer, but a hole all the same.
  let spanEnd = minutesOf(end);
  if (spanEnd <= spanStart) spanEnd += DAY_MINUTES;

  let mins = spanEnd - spanStart;
  for (const s of segments) {
    if (s.isPaid) continue;
    let segStart = minutesOf(s.start);
    let segEnd = minutesOf(s.end);
    if (segEnd < segStart) segEnd += DAY_MINUTES;
    // A segment starting before the shift on an overnight shift belongs to the
    // morning half, not to the evening before it began.
    if (segStart < spanStart) {
      segStart += DAY_MINUTES;
      segEnd += DAY_MINUTES;
    }
    mins -= Math.max(0, Math.min(spanEnd, segEnd) - Math.max(spanStart, segStart));
  }
  return Math.max(0, mins);
}

const key = (userId: number, dateStr: string) => `${userId}:${dateStr}`;

export interface ScheduledShiftsOptions {
  /**
   * Defaults to true — attendance and the time-off import must never see DRAFT
   * weeks. Queue coverage planning passes false so a manager can preview the
   * week they are still building; that view is labelled draft in the UI and
   * scores nothing.
   */
  publishedOnly?: boolean;
}

/**
 * Bulk fetch. Keyed `${userId}:${YYYY-MM-DD}` using local date components.
 * Fetches shifts+segments and exceptions grouped in memory rather than per-shift.
 */
export async function getScheduledShifts(
  userIds: number[],
  from: Date,
  to: Date,
  opts: ScheduledShiftsOptions = {},
): Promise<Map<string, ScheduledDay>> {
  const out = new Map<string, ScheduledDay>();
  if (userIds.length === 0) return out;

  const fromStr = dateStrFromDate(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())));
  const toStr = dateStrFromDate(new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())));

  const shifts = await fetchShiftsInRange(userIds, fromStr, toStr, opts.publishedOnly ?? true);

  const exceptions = await prisma.scheduleException.findMany({
    where: { user_id: { in: userIds }, exception_date: { gte: dateOnlyValue(fromStr), lte: dateOnlyValue(toStr) } },
    include: { exception_type: true },
  });
  const exByKey = new Map<string, ScheduledException[]>();
  for (const e of exceptions) {
    const k = key(e.user_id, dateStrFromDate(e.exception_date));
    const mapped: ScheduledException = {
      id: e.id,
      typeId: e.exception_type_id,
      typeKey: e.exception_type.type_key,
      label: e.exception_type.label,
      isExcused: e.exception_type.is_excused,
      isFullDay: e.is_full_day,
      affectsArrival: e.exception_type.affects_arrival,
      affectsDeparture: e.exception_type.affects_departure,
      start: e.starts_at ? hmFromDateTime(e.starts_at) : null,
      end: e.ends_at ? hmFromDateTime(e.ends_at) : null,
    };
    (exByKey.get(k) ?? exByKey.set(k, []).get(k)!).push(mapped);
  }

  const allDates = new Set<string>();
  for (const s of shifts) allDates.add(dateStrFromDate(s.shift_date));
  const dayTypes = await getCalendarDayTypes([...allDates]);

  for (const s of shifts) {
    const dateStr = dateStrFromDate(s.shift_date);
    const segments: ScheduledSegment[] = s.segments.map((seg) => ({
      activity: seg.activity_type.label,
      start: hmFromDateTime(seg.start_at),
      end: hmFromDateTime(seg.end_at),
      isPaid: seg.activity_type.is_paid,
      countsAsCoverage: seg.activity_type.counts_as_coverage,
    }));
    const dt = dayTypes.get(dateStr);
    const closed = dt === 'HOLIDAY' || dt === 'CLOSURE';
    const start = s.start_at ? hmFromDateTime(s.start_at) : null;
    const end = s.end_at ? hmFromDateTime(s.end_at) : null;

    out.set(key(s.user_id, dateStr), {
      shiftId: s.id,
      start,
      end,
      isDayOff: s.is_day_off || closed,
      scheduledMinutes: s.is_day_off || closed ? 0 : netMinutes(start, end, segments),
      segments,
      exceptions: exByKey.get(key(s.user_id, dateStr)) ?? [],
    });
  }

  return out;
}

/** Single-day convenience over the bulk fetch. */
export async function getScheduledShift(userId: number, date: Date): Promise<ScheduledDay | null> {
  const map = await getScheduledShifts([userId], date, date);
  const dateStr = dateStrFromDate(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
  return map.get(key(userId, dateStr)) ?? null;
}
