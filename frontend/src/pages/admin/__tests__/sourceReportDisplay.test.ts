import { describe, it, expect } from 'vitest'
import { buildDisplayRows } from '../sourceReportDisplay'
import type { SourceReport } from '@/hooks/useSourceReports'

const report = (over: Partial<SourceReport> & { report_code: string; id: number }): SourceReport => ({
  report_name: over.report_code,
  source_pool: 'crm',
  load_mode: 'FULL_RELOAD_WINDOW',
  window_months: 15,
  incremental_days: 45,
  frequency_minutes: 1440,
  run_only_hours: null,
  is_active: true,
  target_fact_table: 'ie_fact_x',
  last_run_at: null,
  next_run_at: null,
  last_status: null,
  ...over,
})

describe('buildDisplayRows', () => {
  it('collapses the five Cycle Performance facts into one scheduler row', () => {
    const rows = buildDisplayRows([
      report({ id: 1, report_code: 'lead' }),
      report({ id: 2, report_code: 'collections_invoice', last_status: 'SUCCESS' }),
      report({ id: 3, report_code: 'collections_task', last_status: 'SUCCESS' }),
      report({ id: 4, report_code: 'collections_billing', last_status: 'SUCCESS' }),
      report({ id: 5, report_code: 'collections_touch', frequency_minutes: 60, last_status: 'SUCCESS' }),
      report({
        id: 6, report_code: 'collections_recovery', frequency_minutes: 60,
        last_status: 'SUCCESS', last_run_at: '2026-09-14T12:00:00Z',
      }),
    ])

    const cycle = rows.find(r => r.kind === 'cycle')
    expect(cycle?.report_name).toBe('Cycle Performance')
    expect(cycle?.ids).toHaveLength(5)
    // Hourly touch/recovery is what will fire the pipeline, so the row says so.
    expect(cycle?.frequency_minutes).toBe(60)
    expect(cycle?.last_status).toBe('SUCCESS')
    expect(cycle?.last_run_at).toBe('2026-09-14T12:00:00Z')
    expect(rows.filter(r => r.report_name.startsWith('collections_'))).toHaveLength(0)
  })

  it('surfaces a failure in any member as the group status', () => {
    const rows = buildDisplayRows([
      report({ id: 2, report_code: 'collections_invoice', last_status: 'SUCCESS' }),
      report({ id: 3, report_code: 'collections_task', last_status: 'FAILED' }),
      report({ id: 4, report_code: 'collections_billing', last_status: null }),
      report({ id: 5, report_code: 'collections_touch', last_status: null }),
      report({ id: 6, report_code: 'collections_recovery', last_status: null }),
    ])

    expect(rows[0].last_status).toBe('FAILED')
  })
})
