/**
 * Shared date formatting helpers.
 *
 * Convention: all calendar-date logic uses LOCAL time components.
 * periodUtils builds dates in local time, MySQL DATETIME columns store
 * business-meaning dates (not UTC instants). Never use toISOString()
 * to extract date/datetime strings for SQL — it shifts by timezone offset.
 */

/** Format a local Date as 'YYYY-MM-DD HH:mm:ss' for SQL DATETIME comparisons. */
export function fmtDatetime(d: Date): string {
  const y   = d.getFullYear()
  const mo  = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h   = String(d.getHours()).padStart(2, '0')
  const mi  = String(d.getMinutes()).padStart(2, '0')
  const s   = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`
}

/** Format a local Date as 'YYYY-MM-DD' for SQL DATE comparisons. */
export function fmtDate(d: Date): string {
  const y   = d.getFullYear()
  const mo  = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}
