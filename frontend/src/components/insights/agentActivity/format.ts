/** Shared display formatters for the Agent Activity report tables. */

export const fmtNum = (v: number): string => v.toLocaleString('en-US')

export const fmtUSD = (v: number): string =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** Plain amount with thousands separators and exactly two decimals (no currency symbol). */
export const fmtAmount = (v: number): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Whole-number percent, e.g. 18 -> "18%". */
export const fmtPctInt = (v: number): string => `${Math.round(v)}%`

export const fmtPct = (v: number, decimals = 1): string => `${v.toFixed(decimals)}%`

export const fmtDays = (v: number): string => `${v.toFixed(1)} days`
