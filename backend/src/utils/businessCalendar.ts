import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

/**
 * Returns true if a given UTC day-of-week (0=Sun … 6=Sat) is a default
 * business day when no calendar row exists (Monday–Friday).
 */
function isDefaultBusinessDay(utcDayOfWeek: number): boolean {
  return utcDayOfWeek >= 1 && utcDayOfWeek <= 5;
}

/**
 * Format a Date as a YYYY-MM-DD string using UTC components so it matches
 * the DATE values stored in business_calendar_days.
 */
export function toDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Count business days between start and end (inclusive).
 *
 * Business day = day_type = 'WORKDAY' in business_calendar_days.
 * For dates with no stored row, Monday–Friday are treated as business days.
 *
 * Uses UTC date math throughout to stay consistent with calendar storage.
 */
export async function countBusinessDays(start: Date, end: Date): Promise<number> {
  // Use local date components — periodUtils builds dates in local time
  const startUTC = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
  const endUTC   = new Date(Date.UTC(end.getFullYear(),   end.getMonth(),   end.getDate()));

  const startStr = toDateString(startUTC);
  const endStr   = toDateString(endUTC);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT calendar_date, day_type FROM business_calendar_days
     WHERE calendar_date >= ? AND calendar_date <= ?`,
    [startStr, endStr],
  );

  // Build a map of dateString → isBusinessDay from DB rows
  const dbMap = new Map<string, boolean>();
  for (const row of rows) {
    const d = row.calendar_date instanceof Date ? row.calendar_date : new Date(row.calendar_date);
    dbMap.set(toDateString(d), row.day_type === 'WORKDAY');
  }

  let count = 0;
  const cursor = new Date(startUTC);
  while (cursor <= endUTC) {
    const key = toDateString(cursor);
    const isBusinessDay = dbMap.has(key)
      ? dbMap.get(key)!
      : isDefaultBusinessDay(cursor.getUTCDay());
    if (isBusinessDay) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

/**
 * Day-of-week for a 'YYYY-MM-DD' string without timezone drift. Parsed at UTC
 * noon so a DST shift can never bump it to the previous day. 0 = Sunday.
 */
function dowOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * Fetch the stored day_type for a set of 'YYYY-MM-DD' strings in one query,
 * returned as a Map. Dates with no row are simply absent from the map, and the
 * caller applies the Mon–Fri default. Used by scheduling apply/copy so a
 * fortnight is one lookup rather than fourteen.
 */
export async function getCalendarDayTypes(dateStrs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (dateStrs.length === 0) return out;
  const placeholders = dateStrs.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT calendar_date, day_type FROM business_calendar_days
     WHERE calendar_date IN (${placeholders})`,
    dateStrs,
  );
  for (const row of rows) {
    const d = row.calendar_date instanceof Date ? row.calendar_date : new Date(row.calendar_date);
    out.set(toDateString(d), row.day_type as string);
  }
  return out;
}

/**
 * True when a single 'YYYY-MM-DD' date is a working business day (day_type
 * 'WORKDAY', or Mon–Fri when no row exists). WEEKEND/HOLIDAY/CLOSURE are false.
 */
export async function isWorkday(dateStr: string): Promise<boolean> {
  const types = await getCalendarDayTypes([dateStr]);
  const t = types.get(dateStr);
  if (t) return t === 'WORKDAY' || t === 'ADJUSTMENT';
  const dow = dowOf(dateStr);
  return dow >= 1 && dow <= 5;
}

/**
 * True when scheduling must skip a date: a stored HOLIDAY or CLOSURE. Weekends
 * are NOT blocked here — people work Saturdays, so apply/copy only skip the
 * two closure types, never the default weekend. Uses a prefetched type map so
 * a bulk write does not query per day.
 */
export function isBlockedForScheduling(dateStr: string, types: Map<string, string>): boolean {
  const t = types.get(dateStr);
  return t === 'HOLIDAY' || t === 'CLOSURE';
}

/** Every 'YYYY-MM-DD' date in a calendar month, in order. month is 1-based. */
export function monthDateStrings(year: number, month: number): string[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    out.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Ordered list of WORKING business days in a month as 'YYYY-MM-DD' strings.
 * A day counts when its stored day_type is WORKDAY/ADJUSTMENT, or — with no
 * stored row — it is Mon–Fri. WEEKEND/HOLIDAY/CLOSURE are excluded. This is the
 * spine the campaign anchor resolver counts over (Nth from start / Nth from end
 * / relative-to-campaign). One DB round-trip for the whole month.
 */
export async function businessDaysOfMonth(year: number, month: number): Promise<string[]> {
  const all = monthDateStrings(year, month);
  const types = await getCalendarDayTypes(all);
  return all.filter((ds) => {
    const t = types.get(ds);
    if (t) return t === 'WORKDAY' || t === 'ADJUSTMENT';
    const dow = dowOf(ds);
    return dow >= 1 && dow <= 5;
  });
}

/**
 * Day-type map for a whole month (every date present), applying the Mon–Fri
 * default where no row exists so the caller never has to. Used by the campaign
 * grid to grey out WEEKEND/HOLIDAY/CLOSURE days.
 */
export async function getMonthDayTypes(year: number, month: number): Promise<Map<string, string>> {
  const all = monthDateStrings(year, month);
  const stored = await getCalendarDayTypes(all);
  const out = new Map<string, string>();
  for (const ds of all) {
    const t = stored.get(ds);
    if (t) out.set(ds, t);
    else {
      const dow = dowOf(ds);
      out.set(ds, dow >= 1 && dow <= 5 ? 'WORKDAY' : 'WEEKEND');
    }
  }
  return out;
}

export interface BusinessDaySummary {
  totalDays:       number;
  businessDays:    number;
  nonBusinessDays: number;
}

/**
 * Return a summary of business / non-business days for a full calendar month.
 * month is 1-based (1 = January).
 */
export async function getBusinessDaySummary(
  year: number,
  month: number,
): Promise<BusinessDaySummary> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end   = new Date(Date.UTC(year, month, 0)); // last day of month

  const totalDays    = end.getUTCDate();
  const businessDays = await countBusinessDays(start, end);

  return {
    totalDays,
    businessDays,
    nonBusinessDays: totalDays - businessDays,
  };
}
