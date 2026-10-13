import { describe, it, expect } from 'vitest'
import { createTable, getCoreRowModel, getSortedRowModel, type SortingState, type TableState } from '@tanstack/react-table'
import { buildDueItemColumns } from '../dueItemsColumns'
import type { PastDueItem } from '@/services/insightsService'

const item = (over: Partial<PastDueItem>): PastDueItem => ({
  agent: 'Ann', processType: 'Task', referenceId: 1, customerName: null, taskType: 'Follow Up',
  classification: null, subClassification: null, status: 'Open', nextContact: '2026-10-01', crmUrl: null,
  ...over,
})

const items = [
  item({ referenceId: 3, agent: 'Cy', customerName: 'Beta', nextContact: '2026-09-02' }),
  item({ referenceId: 1, agent: 'Ann', customerName: 'Gamma', nextContact: '2026-09-03' }),
  item({ referenceId: 2, agent: 'Bo', customerName: 'Alpha', nextContact: '2026-09-01' }),
]

function sortedIds(sorting: SortingState, data = items) {
  const columns = buildDueItemColumns({ showAgent: true, hasTickets: false, detailHead: 'Task Type' })
  let state = { sorting } as unknown as TableState
  const table = createTable({
    data, columns, state, renderFallbackValue: null,
    onStateChange: (u) => { state = typeof u === 'function' ? u(state) : u },
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })
  table.setOptions(prev => ({ ...prev, state }))
  return { table, ids: table.getRowModel().rows.map(r => r.original.referenceId) }
}

describe('buildDueItemColumns', () => {
  it('adds the Agent column only when asked, and the sub-classification only for tickets', () => {
    const ids = (o: Parameters<typeof buildDueItemColumns>[0]) => buildDueItemColumns(o).map(c => c.id)
    expect(ids({ showAgent: false, hasTickets: false, detailHead: 'Task Type' })).not.toContain('agent')
    expect(ids({ showAgent: true, hasTickets: true, detailHead: 'Classification' }))
      .toEqual(['agent', 'referenceId', 'processType', 'customerName', 'detail', 'subClassification', 'status', 'nextContact', 'crm'])
  })

  it('defaults to oldest due date first', () => {
    expect(sortedIds([{ id: 'nextContact', desc: false }]).ids).toEqual([2, 3, 1])
  })

  it('sorts by any data column in either direction', () => {
    expect(sortedIds([{ id: 'customerName', desc: false }]).ids).toEqual([2, 3, 1])
    expect(sortedIds([{ id: 'agent', desc: true }]).ids).toEqual([3, 2, 1])
    expect(sortedIds([{ id: 'referenceId', desc: false }]).ids).toEqual([1, 2, 3])
  })

  it('leaves the CRM link column unsortable', () => {
    const { table } = sortedIds([])
    expect(table.getColumn('crm')!.getCanSort()).toBe(false)
    expect(table.getColumn('status')!.getCanSort()).toBe(true)
  })
})
