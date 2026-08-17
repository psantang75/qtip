import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import MetricTooltip from './MetricTooltip'
import PeerCompareColumn from './PeerCompareColumn'
import { fmtHM, type DayModel, type TimeBucket } from './productivityModel'
import { buildPeerComparison, type PeerState } from './productivityBenchmark'

/**
 * "How the time was spent" — three columns answering three different questions,
 * left to right in the order a manager asks them:
 *
 *   Versus the group   — was this day out of line with the same job?
 *   Call handling      — what did the calls themselves look like?
 *   Time accounting    — where did every clocked minute go?
 *
 * The third column is the one that was missing. Without it the page implied the
 * unaccounted hours instead of naming them, so "they were here eight hours and
 * spent three on the phone" left the other five to guesswork. Its buckets are
 * mutually exclusive and sum back to clocked time, which is what makes it an
 * answer rather than another list of totals.
 *
 * Requires a `TooltipProvider` above it.
 */

const COL_HEAD = 'mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400'
const PAIR = 'flex items-baseline justify-between gap-3'
/** Each of the three answers now lives in its own rounded box. */
const CARD = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm'

interface ListRow { label: string; value: string | number; head?: boolean }

/** Quiet label/value list — an open section, not another bordered panel. */
function ValueList({ title, rows }: { title: string; rows: ListRow[] }) {
  return (
    <div>
      <div className={COL_HEAD}>{title}</div>
      <div className="space-y-2">
        {rows.map(r => (
          r.head ? (
            <div key={r.label} className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {r.label}
            </div>
          ) : (
            <div key={r.label} className={PAIR}>
              <span className="truncate text-[12.5px] text-slate-600">{r.label}</span>
              <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-slate-800">{r.value}</span>
            </div>
          )
        ))}
      </div>
    </div>
  )
}

const ACCOUNT_ROW = 'grid grid-cols-[minmax(0,1fr)_56px_32px] items-baseline gap-2'

function AccountingRow({ bucket, reasons }: { bucket: TimeBucket; reasons: { status: string; mins: number }[] }) {
  const row = (
    <div className={cn(ACCOUNT_ROW, bucket.key.startsWith('off') && 'cursor-help')}>
      <span className="truncate text-[12.5px] text-slate-600">{bucket.label}</span>
      <span className="text-right text-[12.5px] font-medium tabular-nums text-slate-800">{fmtHM(bucket.mins)}</span>
      <span className="text-right text-[11px] tabular-nums text-slate-400">{bucket.pct}%</span>
    </div>
  )

  // Only the off-queue rows hide a breakdown worth reaching for: which presence
  // reasons the agent was actually in while away from the queue.
  if (!bucket.key.startsWith('off') || reasons.length === 0) return row

  return (
    <MetricTooltip
      title={bucket.label}
      description="Time away from the queue, by the presence reason the agent had set. Working means the computer was active; idle means it was not."
      rows={reasons.map(r => ({ label: r.status, value: fmtHM(r.mins) }))}
    >
      {row}
    </MetricTooltip>
  )
}

export default function TimeSpentPanel({ agent, date, model }: { agent: string; date: string; model: DayModel }) {
  const cmp = useMemo(() => buildPeerComparison(agent, date, model), [agent, date, model])
  const worst: PeerState = cmp.flagged.some(f => f.state === 'off') ? 'off' : 'watch'
  const c = model.callSummary
  const t = model.ticketTotals
  const share = (n: number, of: number) => (of > 0 ? ` · ${Math.round((n / of) * 100)}%` : '')

  const callRows: ListRow[] = [
    { label: 'Inbound / Outbound', value: `${c.inbound} / ${c.outbound}` },
    { label: 'Total Talk Time', value: fmtHM(c.talkMins) },
    { label: 'Total Hold Time', value: `${fmtHM(c.holdMins)} · ${c.heldCount} calls` },
    { label: 'After-Call Work', value: fmtHM(c.wrapMins) },
    { label: 'Longest Call', value: fmtHM(c.longestMins) },
    { label: 'Ticket Touches', value: `${t.total} · ${t.completed} closed` },
  ]

  // Shown whenever the agent dialled out, which is the whole day's work on a
  // collections desk and a handful of follow-ups on a support desk.
  if (c.dials > 0) {
    const answered = c.underOneMin + c.overOneMin
    callRows.push(
      { label: 'Dialing', value: '', head: true },
      { label: 'Dials placed', value: c.dials },
      { label: 'Calls Less Than One Minute', value: `${c.underOneMin}${share(c.underOneMin, answered)}` },
      { label: 'Calls Greater Than One Minute', value: `${c.overOneMin}${share(c.overOneMin, answered)}` },
    )
  }

  return (
    <div className="space-y-3">
      {cmp.flagged.length > 0 && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]',
            worst === 'off' ? 'bg-destructive/5 text-destructive' : 'bg-warning/10 text-warning',
          )}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Out of line with the department:{' '}
            <span className="font-semibold">{cmp.flagged.map(f => f.label.toLowerCase()).join(', ')}</span>
          </span>
        </div>
      )}

      {/* Three separate boxes — the department comparison, call handling, and the
          time-accounting waterfall — each an equal third of the row. A solo
          department drops the comparison box, leaving the other two. */}
      <div className={cn(
        'grid grid-cols-1 gap-3 md:grid-cols-2',
        cmp.comparable && 'xl:grid-cols-3',
      )}>
        {cmp.comparable && (
          <div className={CARD}>
            <PeerCompareColumn cmp={cmp} />
          </div>
        )}

        <div className={CARD}>
          <ValueList title="Call Handling and Tickets" rows={callRows} />
        </div>

        <div className={CARD}>
          <div className={COL_HEAD}>Phone Status</div>
          <div className="space-y-2">
            {model.timeAccounting.map(b => (
              <AccountingRow key={b.key} bucket={b} reasons={model.offQueueSummary} />
            ))}
            <div className={cn(ACCOUNT_ROW, 'border-t border-slate-200 pt-2')}>
              <span className="truncate text-[12.5px] font-medium text-slate-700">Paid time</span>
              <span className="text-right text-[12.5px] font-semibold tabular-nums text-slate-900">{fmtHM(model.clockedMin)}</span>
              <span className="text-right text-[11px] tabular-nums text-slate-400">100%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
