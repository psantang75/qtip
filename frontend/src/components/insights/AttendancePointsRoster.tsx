/**
 * AttendancePointsRoster — the roster that IS this page. Grouped by department,
 * ordered by points descending, with each row expanding to the occurrences behind
 * its total via the shared ExpandableRow (so the caret gets its aria-expanded and
 * keyboard behaviour for free).
 *
 * Buckets are 0-30 / 31-60 / 61-90 DAYS, not calendar months. Months would make
 * "the 90-day total" the sum of three unequal spans, and the first of the month
 * would silently reshuffle everyone's numbers. There is deliberately no separate
 * Total column: the three buckets partition the window exactly, so Rolling 90 IS
 * their sum and a fourth number could only ever disagree.
 *
 * Rolling 90, Level and Grace carry the policy behind them in header tooltips
 * (see AttendancePolicyTooltips), so the bands and the discipline ladder sit on
 * the columns they govern rather than in a card of their own.
 */
import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import ExpandableRow from './ExpandableRow'
import {
  LEVEL_VARIANT, fmtDuration, RollingPointsHeader, LevelHeader, GraceHeader,
} from './AttendancePolicyTooltips'
import type {
  AttendanceAgentRow, AttendanceOccurrence, AttendancePointBand, AttendanceWarningLevel,
} from '@/services/insightsCsrService'

// Header and body share one template so the columns line up without a real table.
const GRID = 'grid grid-cols-[minmax(160px,1.5fr)_repeat(4,84px)_repeat(4,68px)_114px] gap-x-2 items-center'

function fmtPoints(n: number): string {
  return n === 0 ? '—' : n.toFixed(2)
}

/** MM-DD-YYYY. Dates arrive as 'YYYY-MM-DD' and are split, never parsed as a
 *  Date — `new Date('2026-07-15')` is UTC midnight and prints as the 14th west
 *  of Greenwich, which would misdate every occurrence by a day. */
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${m}-${d}-${y}`
}

/** '9h 32m' from minutes. Hours alone hide a 29-minute difference. */
function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** '8:30 AM' from 'HH:MM'. Split rather than parsed — these are wall-clock
 *  strings with no date, so constructing a Date would invent one. */
function fmt12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

const timeRange = (start: string | null, end: string | null): string => {
  if (start && end) return `${fmt12h(start)} – ${fmt12h(end)}`
  const one = start ?? end
  return one ? fmt12h(one) : '—'
}

interface RosterProps {
  rows: AttendanceAgentRow[]
  /** Occurrence detail per userId, fetched lazily as rows expand. */
  detail: Record<number, AttendanceOccurrence[] | undefined>
  onExpand: (userId: number) => void
  /** The window every figure in the table covers, both ends inclusive. */
  windowFrom: string
  asOf: string
  /** Point bands and discipline ladder in force, for the header tooltips. */
  bands: AttendancePointBand[]
  levels: AttendanceWarningLevel[]
  /** Highest lateness that still earns nothing, in seconds. Defines grace. */
  graceCeilingSeconds: number | null
}

export default function AttendancePointsRoster({
  rows, detail, onExpand, windowFrom, asOf, bands, levels, graceCeilingSeconds,
}: RosterProps) {
  const [expanded, setExpanded] = useState<number | null>(null)

  const toggle = (userId: number) => {
    const next = expanded === userId ? null : userId
    setExpanded(next)
    if (next !== null) onExpand(next)
  }

  // Department, then points descending: the manager's question is "who in my team
  // is closest to a warning", so the worst row must be the first one they see.
  const sorted = [...rows].sort(
    (a, b) => a.dept.localeCompare(b.dept) || b.rolling90 - a.rolling90 || a.name.localeCompare(b.name),
  )

  if (sorted.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No scheduled days measured in this window.</p>
  }

  let lastDept = ''

  return (
    <div>
      {/* The window every figure below covers, stated once at table level in the
          same form as the Insights filter bar's Date Range row. */}
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500 mb-3">
        <CalendarDays size={13} className="text-primary" />
        <span className="w-2.5 h-px bg-primary inline-block" />
        <CalendarDays size={13} className="text-primary" />
        <span className="ml-1">Date Range:</span>
        <strong className="text-slate-700">{fmtDate(windowFrom)}</strong>
        <span className="text-slate-400">to</span>
        <strong className="text-slate-700">{fmtDate(asOf)}</strong>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div className={cn(GRID, 'text-xs text-slate-400 border-b border-slate-200 pb-2 px-3')}>
            <span className="pl-6">Agent</span>
            <span className="text-right">0–30 Days</span>
            <span className="text-right">31–60 Days</span>
            <span className="text-right">61–90 Days</span>
            <span className="text-right font-semibold text-slate-500">
              <RollingPointsHeader bands={bands} graceCeilingSeconds={graceCeilingSeconds} />
            </span>
            <span className="text-right">Absent</span>
            <span className="text-right">Late</span>
            <span className="text-right">Early</span>
            <span className="text-right"><GraceHeader ceilingSeconds={graceCeilingSeconds} /></span>
            <span className="text-right"><LevelHeader levels={levels} /></span>
          </div>

          <div className="pt-2">
            {sorted.map(r => {
              const showDept = r.dept !== lastDept
              lastDept = r.dept
              return (
                <div key={r.userId}>
                  {showDept && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-surface px-3 py-1.5 mb-2 rounded">
                      {r.dept}
                    </p>
                  )}
                  <ExpandableRow
                    isExpanded={expanded === r.userId}
                    onToggle={() => toggle(r.userId)}
                    summary={
                      <span className={GRID}>
                        <span className="text-slate-700 truncate">{r.name}</span>
                        <span className="text-right tabular-nums text-slate-600">{fmtPoints(r.points0to30)}</span>
                        <span className="text-right tabular-nums text-slate-600">{fmtPoints(r.points31to60)}</span>
                        <span className="text-right tabular-nums text-slate-600">{fmtPoints(r.points61to90)}</span>
                        <span className="text-right tabular-nums font-semibold text-slate-900">{r.rolling90.toFixed(2)}</span>
                        <span className="text-right tabular-nums text-slate-600">{r.absences || '—'}</span>
                        <span className="text-right tabular-nums text-slate-600">{r.lates || '—'}</span>
                        <span className="text-right tabular-nums text-slate-600">{r.earlyLeaves || '—'}</span>
                        <span className="text-right tabular-nums text-slate-500">{r.graceUsed || '—'}</span>
                        <span className="text-right">
                          {r.levelKey
                            ? <StatusBadge label={r.level ?? ''} variant={LEVEL_VARIANT[r.levelKey] ?? 'warning'} />
                            : <StatusBadge label="Clear" variant="good" />}
                        </span>
                      </span>
                    }
                    detail={<RowDetail row={r} occurrences={detail[r.userId]} />}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The two numbers behind the compliance percentage are shown beside it, because a
 * percentage on a discipline report should never be something the reader has to
 * take on trust — 99.1% means nothing until you can see it is 471h of 476h.
 */
function RowDetail({ row, occurrences }: {
  row: AttendanceAgentRow
  occurrences?: AttendanceOccurrence[]
}) {
  return (
    <div>
      {/* One equal-width column per fact so the strip spans the row instead of
          bunching at the left, each value centred beneath its own label. The date
          range is not repeated here: it is stated once above the table. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3 text-[12px]">
        <Fact label="Days Measured">{row.daysMeasured}</Fact>
        <Fact label="Roll-Off Date">{row.rollOffDate ? fmtDate(row.rollOffDate) : '—'}</Fact>
        <Fact label="Points Expire">{row.rollOffDate ? row.rollOffPoints.toFixed(2) : '—'}</Fact>
        <Fact label="Hours Scheduled">{fmtHours(row.scheduledMinutes)}</Fact>
        <Fact label="Hours Worked">{fmtHours(row.adherentMinutes)}</Fact>
        <Fact label="Compliance">
          {row.compliancePct === null ? '—' : `${row.compliancePct.toFixed(1)}%`}
        </Fact>
      </div>

      {occurrences === undefined ? (
        <p className="text-[12px] text-slate-400 pt-6">Loading detail…</p>
      ) : occurrences.length === 0 ? (
        <p className="text-[12px] text-slate-400 pt-6">No point-bearing occurrences in this window.</p>
      ) : (
        // table-fixed gives all six columns the same width regardless of content,
        // so the header rules line up evenly instead of the time columns crowding
        // Reason. Values are centred within their column for the same reason.
        <table className="w-full table-fixed text-[12px] mt-6">
          <thead>
            <tr className="text-[11px] text-slate-400 border-b border-slate-200">
              <th className="text-left pb-1.5 font-medium">Date</th>
              <th className="text-center pb-1.5 font-medium">Scheduled</th>
              <th className="text-center pb-1.5 font-medium">Clock Punch</th>
              <th className="text-center pb-1.5 font-medium">Difference</th>
              <th className="text-center pb-1.5 font-medium">Reason</th>
              <th className="text-right pb-1.5 font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {occurrences.map(o => (
              <tr key={`${o.workDate}-${o.kind}`} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 text-slate-500 whitespace-nowrap tabular-nums">{fmtDate(o.workDate)}</td>
                <td className="py-1.5 text-center text-slate-500 whitespace-nowrap tabular-nums">
                  {timeRange(o.scheduledStart, o.scheduledEnd)}
                </td>
                <td className="py-1.5 text-center whitespace-nowrap tabular-nums">
                  {o.punchIn || o.punchOut
                    ? <span className="text-slate-600">{timeRange(o.punchIn, o.punchOut)}</span>
                    : <span className="text-slate-400">No punch</span>}
                </td>
                <td className="py-1.5 text-center whitespace-nowrap tabular-nums text-slate-600">
                  {/* Full-day occurrences have no meaningful deviation: the whole
                      shift is the difference, which the Reason already says. */}
                  {o.deviationSeconds > 0 ? fmtDuration(o.deviationSeconds) : '—'}
                </td>
                <td className="py-1.5 text-center text-slate-600 truncate">{o.reason}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">{o.points.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col items-center gap-0.5 text-center">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-slate-600 tabular-nums whitespace-nowrap">{children}</span>
    </span>
  )
}
