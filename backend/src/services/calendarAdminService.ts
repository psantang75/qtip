import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { toDateString } from '../utils/businessCalendar';

export type BusinessDayType = 'WORKDAY' | 'WEEKEND' | 'HOLIDAY' | 'CLOSURE' | 'ADJUSTMENT';

export interface CalendarDayRow {
  calendar_date: string;   // YYYY-MM-DD
  day_type:      BusinessDayType;
  is_business_day: boolean;
  note:          string | null;
  is_stored:     boolean;  // false = synthesized default, not yet in DB
}

/** Fetch all stored rows for a month plus synthesized defaults for unstored dates. */
export async function getCalendarMonth(
  year: number,
  month: number,
): Promise<CalendarDayRow[]> {
  const firstDay  = new Date(Date.UTC(year, month - 1, 1));
  const lastDay   = new Date(Date.UTC(year, month, 0));
  const startStr  = toDateString(firstDay);
  const endStr    = toDateString(lastDay);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT calendar_date, day_type, note FROM business_calendar_days
     WHERE calendar_date >= ? AND calendar_date <= ?
     ORDER BY calendar_date`,
    [startStr, endStr],
  );

  // Build a map of stored rows
  const stored = new Map<string, { day_type: BusinessDayType; note: string | null }>();
  for (const row of rows) {
    const d   = row.calendar_date instanceof Date ? row.calendar_date : new Date(row.calendar_date);
    const key = toDateString(d);
    stored.set(key, { day_type: row.day_type as BusinessDayType, note: row.note ?? null });
  }

  // Return a full array for every date in the month
  const result: CalendarDayRow[] = [];
  const cursor = new Date(firstDay);
  while (cursor <= lastDay) {
    const key = toDateString(cursor);
    if (stored.has(key)) {
      const s = stored.get(key)!;
      result.push({
        calendar_date:   key,
        day_type:        s.day_type,
        is_business_day: s.day_type === 'WORKDAY',
        note:            s.note,
        is_stored:       true,
      });
    } else {
      const dow = cursor.getUTCDay(); // 0=Sun … 6=Sat
      const isWeekend = dow === 0 || dow === 6;
      result.push({
        calendar_date:   key,
        day_type:        isWeekend ? 'WEEKEND' : 'WORKDAY',
        is_business_day: !isWeekend,
        note:            null,
        is_stored:       false,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

/** Insert or update a single calendar day. */
export async function upsertCalendarDay(
  dateStr:  string,
  dayType:  BusinessDayType,
  note:     string | null,
): Promise<void> {
  await pool.execute<ResultSetHeader>(
    `INSERT INTO business_calendar_days (calendar_date, day_type, note)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE day_type = VALUES(day_type), note = VALUES(note)`,
    [dateStr, dayType, note ?? null],
  );
}

/**
 * Create default rows (WORKDAY for Mon–Fri, WEEKEND for Sat–Sun) for all
 * dates in a month that do not yet have a stored row. Skips existing rows.
 */
export async function saveMonthDefaults(
  year:  number,
  month: number,
): Promise<{ created: number }> {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay  = new Date(Date.UTC(year, month, 0));
  const startStr = toDateString(firstDay);
  const endStr   = toDateString(lastDay);

  // Find which dates already have rows
  const [existing] = await pool.execute<RowDataPacket[]>(
    `SELECT calendar_date FROM business_calendar_days
     WHERE calendar_date >= ? AND calendar_date <= ?`,
    [startStr, endStr],
  );

  const existingSet = new Set<string>();
  for (const row of existing) {
    const d = row.calendar_date instanceof Date ? row.calendar_date : new Date(row.calendar_date);
    existingSet.add(toDateString(d));
  }

  const toInsert: [string, string, null][] = [];
  const cursor = new Date(firstDay);
  while (cursor <= lastDay) {
    const key = toDateString(cursor);
    if (!existingSet.has(key)) {
      const dow     = cursor.getUTCDay();
      const dayType = (dow === 0 || dow === 6) ? 'WEEKEND' : 'WORKDAY';
      toInsert.push([key, dayType, null]);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (toInsert.length > 0) {
    const placeholders = toInsert.map(() => '(?, ?, ?)').join(', ');
    const flat         = toInsert.flat();
    await pool.execute(
      `INSERT IGNORE INTO business_calendar_days (calendar_date, day_type, note) VALUES ${placeholders}`,
      flat,
    );
  }

  return { created: toInsert.length };
}
