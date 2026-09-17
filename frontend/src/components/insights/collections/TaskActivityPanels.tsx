/**
 * Stage 2 of Cycle Performance — what AR did about the declines.
 *
 * Headlines first (declined / collected / written off / still owed), then the
 * three task outcomes, then who took the cash. Collected sits beside every count
 * because a task closed as Paid does not always have money behind it.
 */
import { fmtUSD, fmtNum } from '@/components/insights/agentActivity/format'
import type { CycleCoverage, CycleProcessor, CycleTouchBand } from '@/types/collections'
import { StatCard } from './cyclePrimitives'
import { pctOf } from './cycleFormat'

const COVERAGE_ORDER = [
  { bucket: 'New Task Created', accent: 'text-success' },
  { bucket: 'Added to Existing Task', accent: 'text-success' },
  { bucket: 'No Task Created', accent: 'text-warning' },
] as const

const PROCESSOR_ORDER = [
  { who: 'Agent', accent: 'text-success' },
  { who: 'Self-Service', accent: 'text-primary' },
  { who: 'System', accent: 'text-neutral-700' },
] as const

const emptyCoverage = { invoices: 0, amount: 0, collected: 0 }

/** Did the decline get picked up, and what has come back on those invoices. */
export function TaskCoverageCards({
  coverage,
  collected,
  collectedInvoices,
  writtenOff,
  outstanding,
}: {
  coverage: CycleCoverage[]
  collected: number
  collectedInvoices: number
  writtenOff: { invoices: number; amount: number }
  outstanding: { invoices: number; amount: number }
}) {
  const by = new Map(coverage.map(c => [c.bucket, c]))
  const declinedAmount = coverage.reduce((a, c) => a + c.amount, 0)
  const declinedInvoices = coverage.reduce((a, c) => a + c.invoices, 0)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Declined on the Run"
          value={fmtUSD(declinedAmount)}
          note={`${fmtNum(declinedInvoices)} invoices`}
        />
        <StatCard
          label="Collected to Date"
          value={fmtUSD(collected)}
          accent={pctOf(collected, declinedAmount)}
          accentClass="text-success"
          note={`${fmtNum(collectedInvoices)} invoices`}
        />
        <StatCard
          label="Written Off to Date"
          value={fmtUSD(writtenOff.amount)}
          accent={pctOf(writtenOff.amount, declinedAmount)}
          accentClass="text-warning"
          note={`${fmtNum(writtenOff.invoices)} invoices`}
        />
        <StatCard
          label="Amount Outstanding"
          value={fmtUSD(outstanding.amount)}
          accent={pctOf(outstanding.amount, declinedAmount)}
          accentClass="text-warning"
          note={`${fmtNum(outstanding.invoices)} invoices still have a balance due`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COVERAGE_ORDER.map(({ bucket, accent }) => {
          const row = by.get(bucket) ?? { bucket, ...emptyCoverage }
          return (
            <StatCard
              key={bucket}
              label={bucket}
              value={fmtUSD(row.amount)}
              accent={pctOf(row.amount, declinedAmount)}
              accentClass={accent}
              note={`${fmtNum(row.invoices)} invoices · ${fmtUSD(row.collected)} collected`}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * Who took the payment. Always the three named channels — unrecovered invoices
 * have no processor, and the coverage row already reports them.
 */
export function ProcessorCards({ processors }: { processors: CycleProcessor[] }) {
  const by = new Map(processors.map(p => [p.who, p]))
  const paid = PROCESSOR_ORDER.map(({ who }) => by.get(who)).filter(
    (p): p is CycleProcessor => !!p && p.collected > 0,
  )
  const total = paid.reduce((a, p) => a + p.collected, 0)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {PROCESSOR_ORDER.map(({ who, accent }) => {
        const row = by.get(who) ?? { who, invoices: 0, amount: 0, collected: 0 }
        return (
          <StatCard
            key={who}
            label={who}
            value={fmtUSD(row.collected)}
            accent={pctOf(row.collected, total)}
            accentClass={accent}
            note={`${fmtNum(row.invoices)} invoices · ${fmtUSD(Math.round(row.collected / Math.max(row.invoices, 1)))} average`}
          />
        )
      })}
    </div>
  )
}

/** Column track shared by the band header, its rows and the total, so they line up. */
const BAND_GRID =
  'grid grid-cols-[minmax(160px,1.7fr)_repeat(7,minmax(78px,1fr))] items-baseline gap-x-3'

const BAND_HEADINGS = [
  'Invoices', 'Declined', 'Recovered', 'Self-Service', 'Agent', 'Credit Memo', 'Still Open',
] as const

const count = (n: number) => (n > 0 ? fmtNum(n) : '—')

/**
 * How much outreach each decline took before it was resolved, and who collected.
 *
 * Banded rather than averaged because the distribution is heavily zero-weighted.
 * The bands count only touches logged before the invoice was paid or written off.
 *
 * Same population and same five outcome buckets as the Task Ended As table above —
 * that table cuts the declines by where the task finished, this one by how much
 * outreach preceded it — so the Total line reconciles against that table row for row.
 * Neither reaches the Declined on the Run card, which also counts declines that never
 * got a task at all.
 */
export function TouchBandPanel({ bands }: { bands: CycleTouchBand[] }) {
  const total = bands.reduce((a, b) => a + b.amount, 0)
  const after = bands.reduce((a, b) => a + b.touchesAfter, 0)
  const unordered = bands.reduce((a, b) => a + b.unresolvedOrder, 0)
  const sum = (k: keyof CycleTouchBand) => bands.reduce((a, b) => a + (Number(b[k]) || 0), 0)

  if (bands.length === 0) {
    return <p className="text-[12.5px] text-slate-500">No tasks were raised on this run.</p>
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div className="min-w-[860px] space-y-2">
          <div className={`${BAND_GRID} px-3 text-[10px] uppercase tracking-wide text-slate-400`}>
            <span>Outreach Before Resolution</span>
            {BAND_HEADINGS.map(h => <span key={h} className="text-right">{h}</span>)}
          </div>

          {bands.map(b => (
            <div key={b.band} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className={BAND_GRID}>
                <span className="text-[12.5px] font-medium text-slate-700">{b.band}</span>
                <span className="text-right text-[12.5px] tabular-nums text-slate-600">{fmtNum(b.invoices)}</span>
                <span className="text-right text-[12.5px] tabular-nums text-slate-600">{fmtUSD(b.amount)}</span>
                <span className="text-right text-[12.5px] font-semibold tabular-nums text-slate-800">
                  {fmtUSD(b.collected)} · {pctOf(b.collected, b.amount)}
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-slate-600">{count(b.selfInvoices)}</span>
                <span className="text-right text-[12.5px] tabular-nums text-slate-600">{count(b.agentInvoices)}</span>
                <span className="text-right text-[12.5px] tabular-nums text-slate-600">{count(b.memoInvoices)}</span>
                <span className="text-right text-[12.5px] tabular-nums text-slate-600">{count(b.openInvoices)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${total > 0 ? (b.amount / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}

          <div className={`${BAND_GRID} rounded-lg bg-slate-100 px-3 py-2 text-[12.5px] font-semibold text-slate-900`}>
            <span>Total — declines with a task</span>
            <span className="text-right tabular-nums">{fmtNum(sum('invoices'))}</span>
            <span className="text-right tabular-nums">{fmtUSD(total)}</span>
            <span className="text-right tabular-nums">
              {fmtUSD(sum('collected'))} · {pctOf(sum('collected'), total)}
            </span>
            <span className="text-right tabular-nums">{count(sum('selfInvoices'))}</span>
            <span className="text-right tabular-nums">{count(sum('agentInvoices'))}</span>
            <span className="text-right tabular-nums">{count(sum('memoInvoices'))}</span>
            <span className="text-right tabular-nums">{count(sum('openInvoices'))}</span>
          </div>
        </div>
      </div>
      {(after > 0 || unordered > 0) && (
        <p className="text-[12px] text-slate-500">
          {after > 0 && (
            <>
              A further {fmtNum(after)} logged move{after === 1 ? '' : 's'} happened after the
              invoice was already settled or written off, so {after === 1 ? 'it is' : 'they are'}
              {' '}not counted as effort that recovered it.
            </>
          )}
          {unordered > 0 && (
            <>
              {after > 0 ? ' ' : ''}
              {fmtNum(unordered)} invoice{unordered === 1 ? ' has' : 's have'} a move stamped at
              the same second as the payment; the source cannot say which came first, so
              {unordered === 1 ? ' it is' : ' those are'} left out of the bands.
            </>
          )}
        </p>
      )}
    </div>
  )
}
