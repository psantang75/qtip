/**
 * Pure formatting + classification helpers for AdherencePointsRoster. Kept in a
 * plain .ts module (no JSX/components) so the roster file stays under the size
 * ceiling and Fast Refresh isn't tripped by mixing helpers with the component.
 */
import type { ComplianceThresholds } from '@/services/insightsAdherenceService'

export const KIND_LABEL: Record<string, string> = {
  BREAK_DURATION: 'Break too long',
  LUNCH_DURATION: 'Lunch too long',
  BREAK_START: 'Break start time',
  LUNCH_START: 'Lunch start time',
  BREAK_PHONE_START: 'Break phone early on',
  BREAK_PHONE_STOP: 'Break phone late off',
  LUNCH_PHONE_START: 'Lunch phone early on',
  LUNCH_PHONE_STOP: 'Lunch phone late off',
  BREAK_MISSED: 'Break missed',
  LUNCH_MISSED: 'Lunch missed',
}

/** Punch (schedule-vs-punch) vs Phone (phone-vs-punch) family of a kind. */
export const kindCategory = (kind: string): 'Punch' | 'Phone' => (kind.includes('PHONE') ? 'Phone' : 'Punch')

export const fmtCount = (n: number): string => (n === 0 ? '—' : String(n))
export const fmtPoints = (n: number): string => (n === 0 ? '—' : n.toFixed(2))
export const fmtPct = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}%`)

/** Red/yellow/green for a compliance %: at/above green → good, at/above yellow →
 *  warning, below → bad. Null (nothing measured) stays neutral. */
export function compVariant(
  pct: number | null,
  t: ComplianceThresholds,
): 'good' | 'warning' | 'bad' | 'neutral' {
  if (pct === null) return 'neutral'
  if (pct >= t.greenMin) return 'good'
  if (pct >= t.yellowMin) return 'warning'
  return 'bad'
}

/** MM-DD-YYYY. Split, never parsed as a Date — `new Date('2026-07-15')` is UTC
 *  midnight and would print the 14th west of Greenwich, misdating every row. */
export function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${m}-${d}-${y}`
}

/** '1h 12m' from seconds. Hours alone hide a scheduled-vs-taken gap of minutes. */
export function fmtHoursFromSec(seconds: number): string {
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Combine an overage duration with its occurrence count ('1h 12m · 5×'), or '—'
 *  when there is nothing over. */
export function overage(seconds: number, count: number): string {
  if (seconds <= 0 && count <= 0) return '—'
  return `${fmtHoursFromSec(seconds)} · ${count}×`
}

/** Seconds -> 'M:SS'. */
export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}

/** 'HH:MM' -> '8:30 AM'. Split, never parsed as a Date — these are wall-clock
 *  strings with no date, so constructing a Date would invent one. */
function fmt12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/** '8:30 AM – 8:45 AM' from a start/stop pair, or '—' when the pair is null. */
export function timeRange(start: string | null, end: string | null): string {
  if (start && end) return `${fmt12h(start)} – ${fmt12h(end)}`
  const one = start ?? end
  return one ? fmt12h(one) : '—'
}
