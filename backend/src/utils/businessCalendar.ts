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
