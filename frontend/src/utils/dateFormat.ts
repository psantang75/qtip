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
  if (typeof value === 'string') {
    // Date-only strings (YYYY-MM-DD) must be parsed as local time to avoid UTC midnight shift
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
    const dateWithOffset = /^\d{4}-\d{2}-\d{2}T/.test(value)
    if (dateOnly) {
      const [y, m, d] = value.split('-')
      const date = new Date(Number(y), Number(m) - 1, Number(d))
      return date.toLocaleDateString('en-US', DISPLAY_OPTIONS)
    }
    if (dateWithOffset) {
      // Datetime strings — strip time and parse date part only to avoid shift
      const datePart = value.slice(0, 10)
      const [y, m, d] = datePart.split('-')
      return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', DISPLAY_OPTIONS)
    }
  }
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
  const end   = new Date(today)
  start.setDate(today.getDate() - 90)
  end.setDate(today.getDate() + 30)
  return { start: fmtLocal(start), end: fmtLocal(end) }
}

/** Format a Date as YYYY-MM-DD using local components (no UTC shift). */
export function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
