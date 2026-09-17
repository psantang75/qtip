/**
 * How the source-report registry is shown on the scheduler page.
 *
 * Two jobs are never one row to the reader, but two pairs of rows are one
 * report: Tickets & Tasks (two extracts under a CRM session cap) and Cycle
 * Performance (five facts that must load in order). Collapsing them here is
 * what keeps the operator from running a member alone.
 */
import type { SourceReport } from '@/hooks/useSourceReports'

export const TICKETS_GROUP = {
  codes: ['ticket_open', 'task_open'],
  representativeCode: 'ticket_open',
  name: 'Tickets & Tasks',
  kind: 'tickets' as const,
}

/** Same load order the backend pipeline uses. Do not reorder here. */
export const CYCLE_GROUP = {
  codes: [
    'collections_task',
    'collections_invoice',
    'collections_billing',
    'collections_touch',
    'collections_recovery',
  ],
  representativeCode: 'collections_recovery',
  name: 'Cycle Performance',
  kind: 'cycle' as const,
}

const GROUPS = [TICKETS_GROUP, CYCLE_GROUP]

export interface DisplayRow {
  key: string
  kind: 'single' | 'tickets' | 'cycle'
  ids: number[]
  report_name: string
  load_mode: SourceReport['load_mode']
  frequency_minutes: number
  run_only_hours: string | null
  last_run_at: string | null
  next_run_at: string | null
  last_status: SourceReport['last_status']
}

function combineStatus(statuses: SourceReport['last_status'][]): SourceReport['last_status'] {
  if (statuses.some(s => s === 'FAILED')) return 'FAILED'
  if (statuses.some(s => s === 'PARTIAL')) return 'PARTIAL'
  if (statuses.length > 0 && statuses.every(s => s === 'SUCCESS')) return 'SUCCESS'
  return null
}

export function buildDisplayRows(reports: SourceReport[]): DisplayRow[] {
  const rows: DisplayRow[] = []
  const emitted = new Set<string>()

  for (const r of reports) {
    const group = GROUPS.find(g => g.codes.includes(r.report_code))
    if (group) {
      if (emitted.has(group.kind)) continue
      emitted.add(group.kind)
      const members = reports.filter(m => group.codes.includes(m.report_code))
      const rep = members.find(m => m.report_code === group.representativeCode) ?? members[0]
      rows.push({
        key: group.codes.join('+'),
        kind: group.kind,
        ids: members.map(m => m.id),
        report_name: group.name,
        load_mode: rep.load_mode,
        // The shortest cadence is the one that will fire the whole group.
        frequency_minutes: Math.min(...members.map(m => m.frequency_minutes)),
        run_only_hours: rep.run_only_hours,
        last_run_at: rep.last_run_at,
        next_run_at: rep.next_run_at,
        last_status: combineStatus(members.map(m => m.last_status)),
      })
    } else {
      rows.push({
        key: r.report_code,
        kind: 'single',
        ids: [r.id],
        report_name: r.report_name,
        load_mode: r.load_mode,
        frequency_minutes: r.frequency_minutes,
        run_only_hours: r.run_only_hours,
        last_run_at: r.last_run_at,
        next_run_at: r.next_run_at,
        last_status: r.last_status,
      })
    }
  }

  return rows
}
