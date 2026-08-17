import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import SortableTable from './SortableTable'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { getTicketTouchDetail, type TouchDetailRow, type TouchDetailParams } from '@/services/insightsService'

/** Time portion of a CRM datetime string ("2026-08-12 14:33:01" -> "14:33"). */
function hhmm(ts: string): string {
  const t = ts.includes('T') ? ts.split('T')[1] : ts.split(' ')[1]
  return t ? t.slice(0, 5) : ts
}

const REASON_TEXT: Record<string, string> = {
  'no-crm-config': 'The CRM connection is not configured in this environment, so live touch detail is unavailable here. Run this on stage/prod.',
  'no-email': 'This agent has no email on their current employee record, so their CRM activity cannot be resolved.',
  'no-crm-user': 'No CRM user matches this agent’s email, so no task/ticket activity could be read.',
}

const COLUMNS: ColumnDef<TouchDetailRow, any>[] = [
  {
    id: 'type', header: 'Type', accessorKey: 'itemType', meta: { width: 'w-[10%]' },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${row.original.itemType === 'task' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'}`}>
          {row.original.itemType === 'task' ? 'Task' : 'Ticket'}
        </span>
        {row.original.isSystem && (
          <span
            className="inline-flex rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
            title="System-generated note — excluded from Touched"
          >
            System
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'item', header: 'ID', meta: { width: 'w-[9%]' },
    accessorFn: (r) => r.itemId,
    cell: ({ row }) => (
      <span className="tabular-nums font-medium text-slate-700">{row.original.itemId}</span>
    ),
  },
  {
    id: 'subject', header: 'Subject', accessorKey: 'subject', meta: { width: 'w-[16%]' },
    cell: ({ getValue }) => <span className="text-slate-700">{(getValue() as string | null) ?? '—'}</span>,
  },
  {
    id: 'actor', header: 'Person', accessorKey: 'actor', meta: { width: 'w-[13%]' },
    cell: ({ getValue }) => <span className="text-slate-700">{(getValue() as string | null) ?? '—'}</span>,
  },
  {
    id: 'note', header: 'Note / Action', accessorKey: 'note', meta: { width: 'w-[40%]' },
    cell: ({ getValue }) => <span className="text-slate-600 whitespace-pre-wrap break-words">{(getValue() as string) || '—'}</span>,
  },
  {
    id: 'time', header: 'Time', meta: { width: 'w-[9%]' },
    accessorFn: (r) => r.occurredAt,
    cell: ({ row }) => <span className="tabular-nums text-slate-500">{hhmm(row.original.occurredAt)}</span>,
  },
  {
    id: 'crm', header: 'CRM', enableSorting: false, meta: { width: 'w-[6%]' },
    cell: ({ row }) => (
      row.original.crmUrl ? (
        <a
          href={row.original.crmUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex text-primary hover:text-primary/70 transition-colors"
          title={`Open ${row.original.itemType} ${row.original.itemId} in the CRM`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className="text-slate-300">—</span>
      )
    ),
  },
]

/**
 * Renders the touch-detail for one agent + one day: a reconciliation banner
 * (distinct touched items vs raw events vs the stored count) and the list of the
 * individual CRM task actions / ticket notes behind it. The CRM read fires only
 * when `params` is set, so callers gate it behind an explicit action (a Run
 * button or opening the drill-down modal). Shared by the standalone validation
 * page and the Workload table's per-day drill-down.
 */
export default function TouchDetailPanel({ params }: { params: TouchDetailParams | null }) {
  const [showSystem, setShowSystem] = useState(false)
  const { data: detail, isFetching, isError } = useQuery({
    queryKey: ['touch-detail', params],
    queryFn: () => getTicketTouchDetail(params as TouchDetailParams),
    enabled: !!params,
    staleTime: 0,
  })

  if (!params) return null
  if (isFetching) return <p className="py-8 text-center text-sm text-slate-400">Reading CRM activity…</p>
  if (isError) return <p className="py-8 text-center text-sm text-danger">Couldn’t read touch detail. Try again.</p>
  if (!detail) return null
  if (detail.reason !== 'ok') {
    return <p className="py-8 text-center text-sm text-slate-500">{REASON_TEXT[detail.reason] ?? `No detail available (${detail.reason}).`}</p>
  }

  const matched = detail.storedTouched != null && detail.storedTouched === detail.distinctItemCount
  // Blank ticket notes (the CRM writes empty companion rows alongside a real
  // note) carry nothing to read — hide them from the list. This is display-only:
  // the item is still counted once via its real note, so the counts/reconciliation
  // (computed server-side over every event) are unaffected.
  const nonBlank = detail.rows.filter((r) => r.note.trim() !== '')
  const systemCount = nonBlank.filter((r) => r.isSystem).length
  const visibleRows = showSystem ? nonBlank : nonBlank.filter((r) => !r.isSystem)

  return (
    <>
      <p className="mb-3 text-[12.5px] leading-relaxed text-slate-500">
        Touched counts distinct tickets &amp; tasks with real human work that day. System-generated
        events (auto-closes, status stamps, ticket transitions) are flagged and excluded from the count.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-surface px-4 py-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Touched (distinct items)</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">{detail.distinctItemCount}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Events (raw notes/actions)</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">{detail.rawEventCount}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">System (excluded)</div>
          <div className="text-lg font-semibold tabular-nums text-slate-500">{systemCount}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Stored “touched”</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900">{detail.storedTouched ?? '—'}</div>
        </div>
        {detail.storedTouched != null && (
          <div className={`flex items-center gap-1.5 text-[12px] font-medium ${matched ? 'text-success' : 'text-warning'}`}>
            {matched ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {matched ? 'Reconciles to stored count' : 'Differs from stored count'}
          </div>
        )}
      </div>

      {systemCount > 0 && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <Switch id="show-system" checked={showSystem} onCheckedChange={setShowSystem} />
          <Label htmlFor="show-system" className="text-[12px] text-slate-500 cursor-pointer">
            Show {systemCount} system event{systemCount === 1 ? '' : 's'}
          </Label>
        </div>
      )}

      {visibleRows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          {detail.rows.length === 0
            ? 'No task or ticket touches recorded for this day.'
            : 'No human touches for this day (only system-generated events).'}
        </p>
      ) : (
        <SortableTable
          columns={COLUMNS}
          data={visibleRows}
          initialSorting={[{ id: 'time', desc: false }]}
          minWidth="min-w-[1040px]"
          rowClassName={(r) => (r.isSystem ? 'bg-slate-50/60 text-slate-400' : '')}
        />
      )}
    </>
  )
}
