/**
 * Shared date formatting utilities — single source for the entire app.
 * One change here updates every list, detail, and PDF view.
 */

const DISPLAY_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}

const DISPLAY_OPTIONS_LONG: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}

const DISPLAY_OPTIONS_DATETIME: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
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

/** Formal long-month format for PDFs / signatures: "April 14, 2026" */
export function formatQualityDateLong(value: string | Date | null | undefined): string {
  if (!value) return '—'
  if (typeof value === 'string') {
    const datePart = value.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [y, m, d] = datePart.split('-')
      return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', DISPLAY_OPTIONS_LONG)
    }
  }
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', DISPLAY_OPTIONS_LONG)
}

/** Date + time for signatures / timestamps: "April 14, 2026, 3:45 PM" */
export function formatQualityDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', DISPLAY_OPTIONS_DATETIME)
}

/**
 * Returns a { start, end } DateRange covering the prior 90 days through 30 days
 * forward (YYYY-MM-DD). Used as the default date range wherever
 * DateRangeFilter appears.
 *
 * Note: this intentionally extends 30 days into the future to surface
 * upcoming-but-already-scheduled records. For the strict "last 90 days
 * through today" window used by the writeup search modals, see
 * {@link priorNinetyDays}.
 */
export function defaultDateRange90(): { start: string; end: string } {
  const today = new Date()
  const start = new Date(today)
  const end   = new Date(today)
  start.setDate(today.getDate() - 90)
  end.setDate(today.getDate() + 30)
  return { start: fmtLocal(start), end: fmtLocal(end) }
}

/**
 * Returns a { from, to } range covering the previous 90 calendar days through
 * today (YYYY-MM-DD strings). Shared by the writeup search modals
 * (`CoachingSearchModal`, `QaSearchModal`) so they cannot drift apart — a
 * duplicate `getPrior90Days` lived in each of them before the pre-production
 * review (item #27).
 */
export function priorNinetyDays(): { from: string; to: string } {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 90)
  return { from: fmtLocal(start), to: fmtLocal(today) }
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
