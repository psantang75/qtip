import { describe, it, expect } from 'vitest'
import { groupRows, summableColumns } from '../onDemandGroups'
import { applyDefaults, differsFromBaseline, toFilterParams } from '../onDemandFilterState'
import type { OnDemandReportColumn, OnDemandReportSummary } from '@/services/onDemandReportsService'

const columns: OnDemandReportColumn[] = [
  { key: 'rep_name', label: 'Rep Name' },
  { key: 'invoiced', label: 'Invoiced', align: 'right', format: 'number' },
  { key: 'outstanding', label: 'Outstanding', align: 'right', format: 'number' },
  { key: 'paid_on', label: 'Paid On', format: 'date' },
]

describe('groupRows', () => {
  const rows = [
    { rep_name: 'Amy', invoiced: 100, outstanding: 100 },
    { rep_name: 'Amy', invoiced: 50.5, outstanding: 0 },
    { rep_name: 'Unassigned', invoiced: 20, outstanding: 20 },
  ]

  it('keeps the server order and buckets rows by the group key', () => {
    const groups = groupRows(rows, 'rep_name', columns)
    expect(groups.map(g => [g.name, g.rows.length])).toEqual([['Amy', 2], ['Unassigned', 1]])
  })

  it('totals only the right-aligned numeric columns', () => {
    expect(summableColumns(columns).map(c => c.key)).toEqual(['invoiced', 'outstanding'])
    const [amy] = groupRows(rows, 'rep_name', columns)
    expect(amy.sums).toEqual({ invoiced: 150.5, outstanding: 100 })
  })
})

describe('on-demand filter state', () => {
  const meta = {
    id: 'failed-charge-invoices-by-agent', name: '', description: '', columns: [], supportedFilters: [],
    defaultFilters: { campaign: 'All Declined', currency: 'USD' },
  } as OnDemandReportSummary

  it('applies collections defaults and sends them', () => {
    const state = applyDefaults(meta)
    expect(toFilterParams(state)).toMatchObject({ campaign: 'All Declined', currency: 'USD', period: 'Current Month' })
    expect(toFilterParams(state).declineReason).toBeUndefined()
  })

  it('treats a changed decline reason as an active filter', () => {
    const base = applyDefaults(meta)
    expect(differsFromBaseline(base, base)).toBe(false)
    expect(differsFromBaseline({ ...base, declineReason: 'Expired Card' }, base)).toBe(true)
  })
})
