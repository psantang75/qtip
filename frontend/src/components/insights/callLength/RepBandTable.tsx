/**
 * Per-agent bucket table for Insights → Agent Activity - CSR → Call Length.
 *
 * Grouped by department with subtotal rows and a grand total, mirroring the
 * grouped-table pattern on the sibling Call Activity page rather than
 * introducing a second table idiom in the same sidebar group.
 *
 * The talk / wrap split sits next to the average so a long average can be read
 * for its cause: a high wrap column is after-call work (often the wrap-up
 * screen timing out), while a high talk column is time on the call itself.
 * "% ≥ 5m" is the column to sort a coaching list by — two agents can share an
 * average while one is uniformly slow and the other has a heavy tail.
 */
import { Fragment } from 'react'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { bandStyle } from './bandStyle'
import type { CallLengthBand, RepBandRow } from '@/types/callLength'

/** Buckets counted as "long", matching LONG_BANDS in the backend rollup. */
const LONG_KEYS = ['m5_10', 'm10_20', 'o20']

interface Totals {
  calls: number
  talkSecs: number
  wrapSecs: number
  handleSecs: number
  bands: Record<string, number>
}

const emptyTotals = (bands: CallLengthBand[]): Totals => ({
  calls: 0, talkSecs: 0, wrapSecs: 0, handleSecs: 0,
  bands: Object.fromEntries(bands.map(b => [b.key, 0])),
})

/** Weight each rep's averages by their own volume so subtotals aren't averages of averages. */
function accumulate(t: Totals, r: RepBandRow, bands: CallLengthBand[]): void {
  t.calls += r.calls
  t.talkSecs += r.avgTalkMin * 60 * r.calls
  t.wrapSecs += r.avgWrapMin * 60 * r.calls
  t.handleSecs += r.avgHandleMin * 60 * r.calls
  for (const b of bands) t.bands[b.key] += r.bands[b.key] ?? 0
}

const avgMin = (secs: number, calls: number) => (calls ? secs / 60 / calls : 0)
const pctLong = (bandCounts: Record<string, number>, calls: number) =>
  calls ? LONG_KEYS.reduce((s, k) => s + (bandCounts[k] ?? 0), 0) / calls * 100 : 0

export default function RepBandTable({ byRep, bands }: { byRep: RepBandRow[]; bands: CallLengthBand[] }) {
  // Preserve the server's ordering (department, then descending volume) while
  // collecting each department's contiguous run of reps.
  const groups: { department: string; rows: RepBandRow[] }[] = []
  for (const r of byRep) {
    const last = groups[groups.length - 1]
    if (last && last.department === r.department) last.rows.push(r)
    else groups.push({ department: r.department, rows: [r] })
  }

  const grand = emptyTotals(bands)
  for (const r of byRep) accumulate(grand, r, bands)

  const numCell = 'py-2.5 pr-4 text-right text-slate-600'
  const totalCell = 'py-2.5 pr-4 text-right'

  return (
    <table className="w-full text-sm [&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4">
      <thead>
        <tr className="text-xs text-slate-400 border-b border-slate-200">
          <th className="text-left  pb-2 font-medium pr-4">Agent</th>
          <th className="text-right pb-2 font-medium pr-4">Calls</th>
          <th className="text-right pb-2 font-medium pr-4">Avg Talk</th>
          <th className="text-right pb-2 font-medium pr-4">Avg Wrap</th>
          <th className="text-right pb-2 font-medium pr-4">Avg Handle</th>
          {bands.map(b => (
            <th key={b.key} className="text-right pb-2 font-medium pr-4">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: bandStyle(b.key).fill, opacity: bandStyle(b.key).fillOpacity }}
                />
                {b.label}
              </span>
            </th>
          ))}
          <th className="text-right pb-2 font-medium">% ≥ 5m</th>
        </tr>
      </thead>
      <tbody>
        {groups.map(group => {
          const sub = emptyTotals(bands)
          for (const r of group.rows) accumulate(sub, r, bands)

          return (
            <Fragment key={group.department}>
              {group.rows.map(r => (
                <tr key={r.agent} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 pr-4 text-slate-600">{r.agent}</td>
                  <td className={numCell}>{fmtNum(r.calls)}</td>
                  <td className={numCell}>{r.avgTalkMin.toFixed(1)}</td>
                  <td className={numCell}>{r.avgWrapMin.toFixed(1)}</td>
                  <td className={numCell}>{r.avgHandleMin.toFixed(1)}</td>
                  {bands.map(b => (
                    <td key={b.key} className={numCell}>{fmtNum(r.bands[b.key] ?? 0)}</td>
                  ))}
                  <td className="py-2.5 text-right text-slate-600">{pctLong(r.bands, r.calls).toFixed(1)}%</td>
                </tr>
              ))}
              <tr className="bg-slate-100 border-b-2 border-slate-200 font-semibold text-slate-900">
                <td className="py-2.5 pr-4">Total - {group.department}</td>
                <td className={totalCell}>{fmtNum(sub.calls)}</td>
                <td className={totalCell}>{avgMin(sub.talkSecs, sub.calls).toFixed(1)}</td>
                <td className={totalCell}>{avgMin(sub.wrapSecs, sub.calls).toFixed(1)}</td>
                <td className={totalCell}>{avgMin(sub.handleSecs, sub.calls).toFixed(1)}</td>
                {bands.map(b => (
                  <td key={b.key} className={totalCell}>{fmtNum(sub.bands[b.key])}</td>
                ))}
                <td className="py-2.5 text-right">{pctLong(sub.bands, sub.calls).toFixed(1)}%</td>
              </tr>
            </Fragment>
          )
        })}
        {groups.length > 1 && (
          <tr className="bg-slate-200 font-semibold text-slate-900">
            <td className="py-2.5 pr-4">All Departments</td>
            <td className={totalCell}>{fmtNum(grand.calls)}</td>
            <td className={totalCell}>{avgMin(grand.talkSecs, grand.calls).toFixed(1)}</td>
            <td className={totalCell}>{avgMin(grand.wrapSecs, grand.calls).toFixed(1)}</td>
            <td className={totalCell}>{avgMin(grand.handleSecs, grand.calls).toFixed(1)}</td>
            {bands.map(b => (
              <td key={b.key} className={totalCell}>{fmtNum(grand.bands[b.key])}</td>
            ))}
            <td className="py-2.5 text-right">{pctLong(grand.bands, grand.calls).toFixed(1)}%</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
