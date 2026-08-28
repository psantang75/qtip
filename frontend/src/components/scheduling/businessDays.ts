/**
 * Reading the business calendar on the client.
 *
 * The single source is the day-type map from `/scheduling/calendar/day-types`
 * (see useBusinessDayTypes). A day is a working business day when its stored
 * type is WORKDAY or ADJUSTMENT; WEEKEND/HOLIDAY/CLOSURE are not. When a date is
 * absent from the map — outside the fetched window — Mon–Fri is assumed, which
 * both matches the backend default and guarantees the arrow walk terminates.
 */
import { addDays } from './mockScheduleData'

export type DayTypeMap = Record<string, string>

const WORKING = new Set(['WORKDAY', 'ADJUSTMENT'])

function dowOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** True when `iso` is a working business day. */
export function isWorkday(map: DayTypeMap | undefined, iso: string): boolean {
  const t = map?.[iso]
  if (t) return WORKING.has(t)
  const dow = dowOf(iso)
  return dow >= 1 && dow <= 5
}

/** A short label for a non-working day, or null when it works (or is a plain weekend). */
export function nonWorkdayLabel(map: DayTypeMap | undefined, iso: string): string | null {
  const t = map?.[iso]
  if (t === 'HOLIDAY') return 'Holiday'
  if (t === 'CLOSURE') return 'Closed'
  if (t === 'WEEKEND') return 'Weekend'
  if (t) return null
  return dowOf(iso) === 0 || dowOf(iso) === 6 ? 'Weekend' : null
}

/**
 * The next working business day from `iso` in direction `dir` (+1 forward, -1
 * back). The date arrows use this so stepping never lands on a weekend, holiday
 * or closure. Bounded so a gap in the fetched map cannot loop forever — beyond
 * the window isWorkday falls back to Mon–Fri, so it always terminates.
 */
export function nextWorkday(map: DayTypeMap | undefined, iso: string, dir: 1 | -1): string {
  let next = addDays(iso, dir)
  for (let i = 0; i < 31 && !isWorkday(map, next); i++) next = addDays(next, dir)
  return next
}
