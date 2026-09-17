/**
 * When is Cycle Performance's load worth interrupting the reader for?
 *
 * This is one job, not five schedules. The banner used to treat a NULL stamp as
 * "never run" — leftover from backfill, or a step the current load has not
 * reached yet — and then offered a button that queued a second job the lock
 * refused. Speak only when a load is in flight, a step failed, a schedule is
 * off, or the finished stamps are a day apart.
 */
import type { CycleDependencyFreshness } from '@/types/collections'

export const SPREAD_HOURS = 24

export interface FreshnessLine {
  code: string
  label: string
  state: string
  isProblem: boolean
}

export interface FreshnessSummary {
  show: boolean
  loading: boolean
  lines: FreshnessLine[]
}

const ago = (from: number, now: number): string => {
  const hours = (now - from) / 3_600_000
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function summariseFreshness(
  items: CycleDependencyFreshness[],
  now: number = Date.now(),
  loading = false,
): FreshnessSummary {
  const stamped = items
    .filter(i => i.lastRunAt)
    .map(i => new Date(i.lastRunAt as string).getTime())
  const spread = stamped.length > 1
    ? (Math.max(...stamped) - Math.min(...stamped)) / 3_600_000
    : 0

  const lines = items.map(i => {
    if (loading && !i.lastRunAt) {
      return {
        code: i.code, label: i.label,
        state: 'waiting in this load',
        isProblem: false,
      }
    }
    const failed = i.status === 'FAILED'
    const off = !i.isActive
    const missing = !i.lastRunAt && !loading && stamped.length === 0
    const isProblem = failed || off || missing
    const loadedAt = i.lastRunAt
      ? `loaded ${ago(new Date(i.lastRunAt).getTime(), now)}`
      : 'no stamp yet'
    const failNote = i.lastRunAt && i.status && i.status !== 'SUCCESS'
      ? ` · last run ${i.status.toLowerCase()}`
      : ''
    const offNote = i.isActive ? '' : ' · schedule is off'
    return { code: i.code, label: i.label, state: `${loadedAt}${failNote}${offNote}`, isProblem }
  })

  const failedOrOff = lines.some(l => l.isProblem)
  const show = loading || failedOrOff || spread >= SPREAD_HOURS
  return { show, loading, lines }
}
