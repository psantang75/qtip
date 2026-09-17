import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtMoney } from '@/components/insights/collections/cycleFormat'
import { InvoicePager } from '@/components/insights/collections/InvoicePager'
import { RESULT_LABEL, PAYER_LABEL, INVOICE_PAGE_SIZE } from './cycleLabels'
import { optionCls } from '@/utils/forms/optionCls'
import { buildCrmOrderUrl } from '@/utils/crmLinks'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import type { CycleInvoice } from '@/types/collections'

/** One filter pill above the grid — the value posted to the server and its label. */
export interface InvoiceFilter {
  value: string
  label: string
}

/**
 * The grid's standard cell: the answer on top, the detail that qualifies it underneath.
 *
 * Every pairing here used to be flattened onto one line with a separator — "••4242 · BG
 * 98280", "$433.43 · 2026-08-04" — which made each column wide enough for its longest
 * row and left eleven columns fighting for the width. Stacking keeps both values and
 * roughly halves the column.
 */
function Stack({ top, sub }: { top: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="leading-tight">
      <div>{top}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div> : null}
    </div>
  )
}

const dash = <span className="text-slate-300">—</span>

export function CycleInvoiceGrid({
  rows,
  filters,
  selected,
  onSelect,
  page,
  pageCount,
  total,
  onPage,
}: {
  rows: CycleInvoice[]
  filters: InvoiceFilter[]
  selected: string
  onSelect: (value: string) => void
  page: number
  pageCount: number
  total: number
  onPage: (page: number) => void
}) {
  // Ordered as the invoice's own story reads: was this a known-bad card, which invoice,
  // when and for how much, which run it was on and what the gateway said, then how the
  // money came back and on which card, what is still owed, and who took it.
  const columns = useMemo<ColumnDef<CycleInvoice, unknown>[]>(() => [
    {
      // Still its own column purely so it stays sortable — a reader chasing repeat
      // failures wants them grouped, and an icon buried inside the invoice cell cannot
      // be sorted on. Narrowed to the icon alone to pay for that.
      accessorKey: 'isRepeat', header: 'Repeat', meta: { width: 'w-[5%]' },
      cell: c => c.getValue<boolean>()
        ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex text-warning" tabIndex={0} aria-label="Repeat issue">
                <RefreshCw className="h-4 w-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[300px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
            >
              <div className="text-[13px] font-semibold text-slate-900">Repeat Issue</div>
              <p className="mt-1 text-[12.5px] leading-snug text-slate-600">
                This billing group already declined within the last year, so the same card is
                still on file and still failing.
              </p>
            </TooltipContent>
          </Tooltip>
        )
        : dash,
    },
    {
      accessorKey: 'orderId', header: 'Invoice #', meta: { width: 'w-[8%]' },
      cell: c => {
        const r = c.row.original
        const url = buildCrmOrderUrl(r.customerId, r.orderId)
        return (
          <Stack
            top={url
              ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {r.orderId}
                </a>
              )
              : r.orderId}
            sub={r.customerId ? `Cust ${r.customerId}` : null}
          />
        )
      },
    },
    {
      accessorKey: 'orderDate', header: 'Invoice Date', meta: { width: 'w-[8%]' },
      cell: c => formatQualityDate(c.getValue<string>()),
    },
    {
      accessorKey: 'amount', header: 'Invoiced', meta: { width: 'w-[9%]', bold: true },
      cell: c => fmtMoney(c.getValue<number>(), c.row.original.currency),
    },
    { accessorKey: 'campaign', header: 'Campaign', meta: { width: 'w-[10%]' } },
    {
      // The reason is the result's own explanation, so it belongs under it rather than
      // in a column of its own that is blank for every row that did not fail.
      accessorKey: 'result', header: 'Run Result', meta: { width: 'w-[12%]' },
      cell: c => (
        <Stack
          top={RESULT_LABEL[c.getValue<string>()] ?? c.getValue<string>()}
          sub={c.row.original.declineReason}
        />
      ),
    },
    { accessorKey: 'recoveryPath', header: 'Recovery Path', meta: { width: 'w-[11%]' } },
    {
      accessorKey: 'collected', header: 'Recovered', meta: { width: 'w-[10%]' },
      cell: c => {
        const r = c.row.original
        if (r.collected <= 0) return dash
        return <Stack top={fmtMoney(r.collected, r.currency)} sub={formatQualityDate(r.paidOn)} />
      },
    },
    {
      accessorKey: 'chargeLast4', header: 'Card Charged', meta: { width: 'w-[9%]' },
      cell: c => {
        const r = c.row.original
        if (!r.chargeBillingGroupId) return dash
        return (
          <Stack
            top={r.chargeLast4 ? `••${r.chargeLast4}` : 'Card not recorded'}
            sub={`BG ${r.chargeBillingGroupId}`}
          />
        )
      },
    },
    {
      accessorKey: 'openBalance', header: 'Outstanding', meta: { width: 'w-[8%]', bold: true },
      cell: c => {
        const r = c.row.original
        return r.openBalance > 0 ? fmtMoney(r.openBalance, r.currency) : dash
      },
    },
    {
      // All three classes arrive carrying a person's name, so the name on its own cannot
      // tell a member of staff from the customer paying through the portal.
      accessorKey: 'processor', header: 'Processed By', meta: { width: 'w-[10%]' },
      cell: c => {
        const r = c.row.original
        if (!r.processor) return dash
        return <Stack top={r.processor} sub={PAYER_LABEL[r.processorClass ?? ''] ?? null} />
      },
    },
  ], [])

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {filters.map(f => (
          <button
            key={f.value}
            type="button"
            onClick={() => onSelect(f.value)}
            className={cn(
              'h-7 rounded border px-3 text-[12px] font-medium transition-all',
              optionCls(selected === f.value),
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <TooltipProvider>
        <SortableTable
          columns={columns}
          data={rows}
          initialSorting={[{ id: 'amount', desc: true }]}
          minWidth="min-w-[1180px]"
        />
      </TooltipProvider>
      <InvoicePager
        page={page}
        pageCount={pageCount}
        pageSize={INVOICE_PAGE_SIZE}
        total={total}
        onPage={onPage}
      />
    </>
  )
}
