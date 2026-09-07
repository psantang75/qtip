/**
 * Shared constants + pure formatters for the effective-dated policy editors
 * (Attendance, Adherence) in List Management. Kept as a plain `.ts` module (no
 * component exports) so Fast Refresh stays happy; the shared `EffectiveFromFooter`
 * component lives in its own file.
 */
export const CARD = 'bg-white rounded-xl border border-slate-200 p-4'
export const SUBHEAD = 'text-[10px] font-semibold uppercase tracking-wide text-slate-400'

export const today = () => new Date().toISOString().slice(0, 10)

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** 'M:SS' from seconds — how the policy tables are written. Blank means unbounded. */
export function toMmSs(seconds: number | null): string {
  if (seconds === null) return ''
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}

/** Parse 'M:SS' or plain minutes back to seconds. Returns null for blank. */
export function fromMmSs(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parts = trimmed.split(':')
  const m = Number(parts[0]) || 0
  const s = parts.length > 1 ? Number(parts[1]) || 0 : 0
  return m * 60 + s
}
