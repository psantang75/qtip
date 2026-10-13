/**
 * Column set for the Past Due / Due Today item dialog. Every data column sorts;
 * the CRM link column does not, since a URL has no meaningful order.
 */
import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { formatQualityDate } from '@/utils/dateFormat'
import type { PastDueItem } from '@/services/insightsService'

const dash = (v: string | null) => (v ? v : '—')

interface DueItemColumnOptions {
  /** The list spans more than one agent (the Grand Total). */
  showAgent: boolean
  /** At least one ticket is listed, so the ticket-only sub-classification applies. */
  hasTickets: boolean
  /** Header for the classification / task-type column. */
  detailHead: string
}

export function buildDueItemColumns({
  showAgent, hasTickets, detailHead,
}: DueItemColumnOptions): ColumnDef<PastDueItem, unknown>[] {
  const cols: ColumnDef<PastDueItem, unknown>[] = []
  if (showAgent) {
    cols.push({ id: 'agent', accessorKey: 'agent', header: 'Agent', meta: { width: 'w-[13%]' } })
  }
  cols.push(
    {
      id: 'referenceId', accessorKey: 'referenceId', header: 'ID', meta: { width: 'w-[9%]' },
      cell: c => <span className="font-medium text-slate-700">{c.getValue<number>()}</span>,
    },
    { id: 'processType', accessorKey: 'processType', header: 'Type', meta: { width: 'w-[7%]' } },
    {
      id: 'customerName', accessorFn: r => r.customerName ?? '', header: 'Customer',
      meta: { width: hasTickets ? 'w-[17%]' : 'w-[22%]' },
      cell: c => dash(c.row.original.customerName),
    },
    {
      id: 'detail', accessorFn: r => r.classification ?? r.taskType ?? '', header: detailHead,
      meta: { width: hasTickets ? 'w-[15%]' : 'w-[20%]' },
      cell: c => dash(c.row.original.classification ?? c.row.original.taskType),
    },
  )
  if (hasTickets) {
    cols.push({
      id: 'subClassification', accessorFn: r => r.subClassification ?? '', header: 'Sub-Classification',
      meta: { width: 'w-[15%]' },
      cell: c => dash(c.row.original.subClassification),
    })
  }
  cols.push(
    {
      id: 'status', accessorFn: r => r.status ?? '', header: 'Status',
      meta: { width: hasTickets ? 'w-[13%]' : 'w-[18%]' },
      cell: c => dash(c.row.original.status),
    },
    {
      id: 'nextContact', accessorFn: r => r.nextContact ?? '', header: 'Next Contact',
      meta: { width: 'w-[11%]' },
      cell: c => <span className="whitespace-nowrap text-slate-500">{formatQualityDate(c.row.original.nextContact)}</span>,
    },
    {
      id: 'crm', header: 'CRM', enableSorting: false, meta: { width: 'w-[5%]' },
      cell: c => {
        const it = c.row.original
        if (!it.crmUrl) return <span className="text-slate-300">—</span>
        return (
          <a
            href={it.crmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-primary hover:text-primary/70 transition-colors"
            title={`Open ${it.processType.toLowerCase()} ${it.referenceId} in the CRM`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )
      },
    },
  )
  return cols
}
