/**
 * The work items behind one Past Due or Due Today count on a Tickets & Tasks
 * report — a single classification row, an agent's total, or the Grand Total.
 * Read-only and act-on-it: every row carries its CRM deep link so the viewer can
 * open the ticket/task in a new tab and clear it. Every column sorts.
 *
 * Shared by the Sales and CSR reports — the caller supplies the fetcher, which is
 * the only thing that differs between the two sections.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type SortingState,
} from '@tanstack/react-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { PastDueItem, PastDueQuery } from '@/services/insightsService'
import SortHeaderIcon from './SortHeaderIcon'
import type { AgentColMeta } from './SortableTable'
import { buildDueItemColumns } from './dueItemsColumns'

export type DueItemsBucket = 'past-due' | 'due-today'

export interface PastDueTarget {
  /** Omitted for the Grand Total. */
  agent?: string
  /** Omitted for an agent total or the Grand Total. */
  classification?: string
  bucket: DueItemsBucket
}

/** The page's CSV Agent / Department filters — they shape the Grand Total list. */
export type DueItemsPageFilters = Pick<PastDueQuery, 'users' | 'departments'>

interface PastDueItemsModalProps {
  /** The cell that was opened. `null` keeps the dialog closed. */
  target: PastDueTarget | null
  onClose: () => void
  fetchPastDue: (q: PastDueQuery) => Promise<PastDueItem[]>
  fetchDueToday: (q: PastDueQuery) => Promise<PastDueItem[]>
  /** Distinguishes the Sales and CSR caches, which scope to different agents. */
  queryKeyPrefix: string
  pageFilters?: DueItemsPageFilters
}

const COPY: Record<DueItemsBucket, { title: string; empty: string; error: string; count: (n: number) => string }> = {
  'past-due': {
    title: 'Past Due',
    empty: 'No past due items.',
    error: "Couldn't load past due items. Close and try again.",
    count: (n) => `${n} overdue item${n === 1 ? '' : 's'}`,
  },
  'due-today': {
    title: 'Due Today',
    empty: 'No items due today.',
    error: "Couldn't load items due today. Close and try again.",
    count: (n) => `${n} item${n === 1 ? '' : 's'} due today`,
  },
}

const DEFAULT_SORT: SortingState = [{ id: 'nextContact', desc: false }]

export default function PastDueItemsModal({
  target, onClose, fetchPastDue, fetchDueToday, queryKeyPrefix, pageFilters,
}: PastDueItemsModalProps) {
  const bucket = target?.bucket ?? 'past-due'
  const copy = COPY[bucket]
  // Only the Grand Total leans on the page filters; a named agent already pins the scope.
  const filters = target && !target.agent ? pageFilters : undefined
  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'insights', 'tickets', queryKeyPrefix, bucket, target?.agent, target?.classification,
      filters?.users, filters?.departments,
    ],
    queryFn:  () => {
      const q: PastDueQuery = {
        agent: target!.agent, classification: target!.classification,
        users: filters?.users, departments: filters?.departments,
      }
      return bucket === 'due-today' ? fetchDueToday(q) : fetchPastDue(q)
    },
    enabled:  !!target,
    staleTime: 0,
  })

  const items = data ?? []

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-6xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <DialogTitle>{copy.title} — {target?.classification ?? 'All Classifications'}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-slate-500">
            {target?.agent ?? 'All agents'}
            {items.length > 0 && ` · ${copy.count(items.length)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-danger text-center py-8">{copy.error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">{copy.empty}</p>
          ) : (
            // Keyed on the opened cell so each new list starts on the default sort.
            <DueItemsTable key={`${bucket}-${target?.agent}-${target?.classification}`} items={items} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DueItemsTable({ items }: { items: PastDueItem[] }) {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT)

  // Tickets and tasks describe themselves with different fields, so the detail
  // column is labelled for whichever type is on screen and the ticket-only
  // sub-classification column is dropped when there are no tickets.
  const columns = useMemo(() => {
    const hasTickets = items.some((it) => it.processType === 'Ticket')
    const hasTasks   = items.some((it) => it.processType === 'Task')
    return buildDueItemColumns({
      showAgent: new Set(items.map((it) => it.agent)).size > 1,
      hasTickets,
      detailHead: hasTickets && hasTasks ? 'Classification / Task Type' : hasTasks ? 'Task Type' : 'Classification',
    })
  }, [items])

  const table = useReactTable({
    data: items, columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  const widthOf = (meta: unknown) => (meta as AgentColMeta | undefined)?.width ?? ''

  return (
    <table className="w-full text-sm table-fixed [&_th:first-child]:pl-5 [&_td:first-child]:pl-5 [&_th:last-child]:pr-5 [&_td:last-child]:pr-5">
      {/* Frozen while the list scrolls. `sticky` resolves against the dialog body's
          own scroll container, so the header must not be wrapped in another
          overflow box (which is why this is a plain table, not ui/table), and
          the rule rides on the th cells because a border on a sticky <tr>
          drops out mid-scroll in Chrome. */}
      <thead className="sticky top-0 z-10 bg-white [&_th]:border-b [&_th]:border-slate-200">
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id} className="text-xs text-slate-400">
            {hg.headers.map(header => {
              const canSort = header.column.getCanSort()
              return (
                <th
                  key={header.id}
                  className={`text-left py-2 pr-3 font-medium select-none ${canSort ? 'cursor-pointer' : ''} ${widthOf(header.column.columnDef.meta)}`}
                  onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                >
                  <span className="flex items-center gap-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    <SortHeaderIcon sorted={header.column.getIsSorted()} canSort={canSort} />
                  </span>
                </th>
              )
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map(row => (
          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
            {row.getVisibleCells().map(cell => (
              <td key={cell.id} className="py-2.5 pr-3 text-slate-600">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
