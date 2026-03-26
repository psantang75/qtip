/**
 * Shared date formatting utilities for the Quality section.
 * Single source — one change updates every list/detail view.
 */

const DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}

/** Formats an ISO date string (or Date) for display: "Mar 24, 2026" */
export function formatQualityDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', DISPLAY_OPTIONS)
}

/**
 * Returns a { start, end } DateRange covering the prior 90 days through today (YYYY-MM-DD).
 * Used as the default date range wherever DateRangeFilter appears.
 */
export function defaultDateRange90(): { start: string; end: string } {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 90)
  const fmt = (d: Date) => d.toISOString().split('T')[0]
  return { start: fmt(start), end: fmt(today) }
}

/**
 * Formats a YYYY-MM-DD string (metadata date field) without timezone shift.
 * "2026-03-24" → "Mar 24, 2026"
 */
export function formatMetadataDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const [y, m, d] = raw.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', DISPLAY_OPTIONS)
}
