import { ShieldCheck, UserMinus, RotateCcw, FileX, ClipboardList, PhoneCall } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { fmtUSD, fmtPct, fmtNum } from '@/components/insights/agentActivity/format'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { OutcomeTile } from './DeclinedBasisPanels'
import type {
  TouchStat, SubscriptionOutcome, PostMemoRecovery, SubStatusCount, TouchAgentStat,
} from '@/types/collections'

/**
 * Panels specific to the Collections Campaign × Touch report — the per-touch expand,
 * the post-memo summary and the subscription outcomes. Split out of the page so the
 * page itself stays a layout file.
 *
 * The opening tiles live in `DeclinedBasisPanels`, shared with Agent Performance,
 * because both reports open on the same declined invoices.
 */

/**
 * Hover card for Marginal Recovery.
 *
 * Replaces Recharts' default list, which could only show what was plotted. Two of the
 * four measures a rung carries are far too small to draw — September's cohort reactivated
 * 15 services against hundreds saved, and $606 against $50,430 — so on a shared scale
 * they are a flat line on the axis and read as zero. They are real outcomes, so they are
 * reported here at full precision instead of being implied by a pixel.
 *
 * Saves and win-backs are kept on separate rows for the same reason they are separate
 * series: one kept the service, the other lost it and bought it back.
 */
export function TouchChartTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: TouchStat & { subs: number | null } }>
}) {
  const r = payload?.[0]?.payload
  if (!active || !r) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg min-w-[200px]">
      <div className="text-[13px] font-semibold text-slate-900">{r.label}</div>
      <div className="text-[12.5px] text-slate-600 mt-0.5">
        {fmtNum(r.touchesMade)} touches · {fmtNum(r.tasksReached)} tasks reached
      </div>
      {/* Named for what actually happened to the service, because "saved" and
          "reactivated" are easy to read as the same thing. They are not, and they share
          no services: at this rung the saved column is subscriptions still running on an
          invoice that got paid, while the reactivated column is subscriptions that were
          shut off and later came back. */}
      <div className="mt-2 space-y-1.5">
        <TipRow
          label="Saved — invoice paid, service kept"
          value={`${fmtUSD(r.incrementalDollars)} · ${fmtNum(r.subs ?? 0)} subs`}
        />
        <TipRow
          label="Reactivated — shut off, then won back"
          value={`${fmtUSD(r.reactivationDollars)} · ${fmtNum(r.reactivationSubs)} subs`}
        />
        <TipRow label="Cumulative save rate" value={fmtPct(r.cumulativeRate)} />
        <TipRow label="Cumulative reactivation rate" value={fmtPct(r.cumulativeReactivationRate)} />
      </div>
    </div>
  )
}

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-[12.5px] text-slate-900">{value}</div>
    </div>
  )
}

/**
 * What the campaign did AFTER writing an invoice off.
 *
 * The ladder above stops at the memo, which reads as though the work stopped there too.
 * It does not: the task stays open, keeps being touched, and some of those services come
 * back on a new invoice. This reports that effort and the cash behind it.
 */
export function PostMemoPanel({ p }: { p: PostMemoRecovery }) {
  const workedRate = p.tasks ? (p.tasksWorkedAfter / p.tasks) * 100 : 0
  const backRate = p.dollars ? (p.reactivationCash / p.dollars) * 100 : 0
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OutcomeTile
          icon={<FileX className="h-4 w-4 text-warning" />}
          label="Written Off" value={fmtUSD(p.dollars)}
          sub={`${fmtNum(p.invoices)} invoices · ${fmtNum(p.tasks)} tasks`}
        />
        <OutcomeTile
          icon={<ClipboardList className="h-4 w-4 text-primary" />}
          label="Still Worked" value={fmtNum(p.tasksWorkedAfter)}
          sub={`${fmtPct(workedRate)} of memoed tasks`}
        />
        <OutcomeTile
          icon={<PhoneCall className="h-4 w-4 text-primary" />}
          label="Touches After" value={fmtNum(p.touchesAfter)}
          sub="Effort the ladder above ends before"
        />
        <OutcomeTile
          icon={<RotateCcw className="h-4 w-4 text-success" />}
          label="Reactivated" value={fmtUSD(p.reactivationCash)}
          sub={`${fmtNum(p.reactivationInvoices)} new invoices · ${fmtPct(backRate)} of written off`}
        />
      </div>
      {p.invoices === 0 && (
        <p className="text-[12px] text-slate-500">
          Nothing was written off in this window, so there is no post-memo recovery to report.
        </p>
      )}
    </div>
  )
}

/**
 * `totalSubs` is the cohort's own subscription count — the figure on the Starting Point
 * tile. The rates used to divide by "worked" (retained + terminated + reactivated),
 * a denominator that appears nowhere else on the page and that quietly excluded any
 * subscription the campaign never resolved, so the percentages could not be reconciled
 * against anything the reader could see. Scoring against the declined population makes
 * every rate here answer the same question the dollar rates do.
 */
export function SubscriptionOutcomes({ s, totalSubs }: {
  s: SubscriptionOutcome
  totalSubs: number
}) {
  const pctOfDeclined = (n: number) => (totalSubs ? (n / totalSubs) * 100 : 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <OutcomeTile
          icon={<ShieldCheck className="h-4 w-4 text-success" />}
          label="Retained" value={fmtNum(s.retained)}
          sub={`${fmtPct(pctOfDeclined(s.retained))} of declined subs · ${fmtUSD(s.retainedMrr)} MRR`}
        />
        <OutcomeTile
          icon={<UserMinus className="h-4 w-4 text-danger" />}
          label="Terminated (AR)" value={fmtNum(s.terminated)}
          sub={`${fmtPct(pctOfDeclined(s.terminated))} of declined subs · ${fmtUSD(s.lostMrr)} MRR lost · ${fmtNum(s.terminatedOther)} non-AR`}
        />
        <OutcomeTile
          icon={<RotateCcw className="h-4 w-4 text-primary" />}
          label="Reactivated" value={fmtNum(s.reactivated)}
          sub={`${fmtPct(pctOfDeclined(s.reactivated))} of declined subs · termed then won back`}
        />
      </div>

      {s.terminatedByStatus.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">Terminated at Status</div>
          <SortableTable
            columns={TERM_STATUS_COLUMNS}
            data={s.terminatedByStatus}
            initialSorting={[{ id: 'count', desc: true }]}
            minWidth="min-w-[320px]"
          />
        </div>
      )}
    </div>
  )
}

export function TouchDetail({ t }: { t: TouchStat }) {
  const collectRate = t.tasksReached ? (t.tasksRecovered / t.tasksReached) * 100 : 0
  const avgTouches = t.accountsReached ? t.touchesMade / t.accountsReached : 0
  const lowReturn = !t.isTerm && t.incrementalRate < 2

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 justify-items-center text-center">
        <Cellv label="Payments Collected" value={fmtNum(t.payments)} />
        <Cellv label="Tasks Recovered" value={fmtNum(t.tasksRecovered)} />
        <Cellv label="Recovery Rate (this touch)" value={fmtPct(collectRate)} />
        <Cellv label="Marginal Gain" value={`+${fmtPct(t.incrementalRate)}`} />
        <Cellv label="Agent-Processed $" value={fmtUSD(t.agentDollars)} />
        <Cellv label="Self-Service $" value={fmtUSD(t.noAgentDollars)} />
        <Cellv label="Cumulative Recovered" value={fmtUSD(t.cumulativeDollars)} />
        <Cellv label="Avg Touches / Customer" value={avgTouches.toFixed(1)} />
      </div>
      {lowReturn && (
        <p className="text-[12px] text-danger">
          Low marginal return: {fmtNum(t.touchesMade)} touches on {fmtNum(t.accountsReached)} customers added only
          {' '}+{fmtPct(t.incrementalRate)} recovery — a candidate to trim from the cadence.
        </p>
      )}

      <div className="pt-1">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">By Agent</div>
        <SortableTable
          columns={TOUCH_AGENT_COLUMNS}
          data={t.agents}
          initialSorting={[{ id: 'collected', desc: true }]}
          minWidth="min-w-[560px]"
        />
      </div>
    </div>
  )
}

/**
 * Column definitions for the two breakdowns inside an expanded touch row.
 *
 * Module-level constants rather than inline literals: a touch row is remounted every
 * time the reader expands one, and a fresh `columns` array identity on each render
 * makes TanStack rebuild the table instead of reusing it.
 */
const TERM_STATUS_COLUMNS: ColumnDef<SubStatusCount, unknown>[] = [
  {
    id: 'status',
    header: 'Task Status at Termination',
    accessorKey: 'status',
    meta: { width: 'w-[65%]' },
  },
  {
    id: 'count',
    header: 'Subscriptions',
    accessorKey: 'count',
    cell: ({ row }) => fmtNum(row.original.count),
    meta: { width: 'w-[35%]', bold: true },
  },
]

const TOUCH_AGENT_COLUMNS: ColumnDef<TouchAgentStat, unknown>[] = [
  { id: 'agent', header: 'Agent', accessorKey: 'agent', meta: { width: 'w-[30%]' } },
  {
    id: 'touchesMade',
    header: 'Touches',
    accessorKey: 'touchesMade',
    cell: ({ row }) => fmtNum(row.original.touchesMade),
    meta: { width: 'w-[14%]' },
  },
  {
    id: 'customers',
    header: 'Customers',
    accessorKey: 'customers',
    cell: ({ row }) => fmtNum(row.original.customers),
    meta: { width: 'w-[14%]' },
  },
  {
    id: 'subs',
    header: 'Subs',
    accessorKey: 'subs',
    cell: ({ row }) => fmtNum(row.original.subs),
    meta: { width: 'w-[12%]' },
  },
  {
    id: 'payments',
    header: 'Payments',
    accessorKey: 'payments',
    cell: ({ row }) => fmtNum(row.original.payments),
    meta: { width: 'w-[14%]' },
  },
  {
    id: 'collected',
    header: 'Collected',
    accessorKey: 'collected',
    cell: ({ row }) => fmtUSD(row.original.collected),
    meta: { width: 'w-[16%]', bold: true },
  },
]

function Cellv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  )
}
