/**
 * AdherencePointsRoster — the break/lunch/phone twin of AttendancePointsRoster.
 * Same shape on purpose: grouped by department, ordered worst-first, each row a
 * person headline that expands via the shared ExpandableRow (so the caret gets its
 * aria-expanded and keyboard behaviour for free) to the rolling-90 detail behind
 * the totals.
 *
 * The summary row shows the deviation counts per family — Punch (Start / Long /
 * Missed) and Phone (Start / Stop) — then ONE combined Rolling-90 point total
 * (punch + phone) bucketed by age (0-30 / 31-60 / 61-90 / Total) and a single
 * Total adherence %. Points show even while report-only so managers can see what
 * is accumulating; the discipline Standing still reads "Report-only" until an
 * admin switches points on. Per-family overage (time + occurrences) and the
 * punch/phone/total adherence breakdown live in the drill-down.
 */
import { useState } from 'react'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import ExpandableRow from './ExpandableRow'
import { LEVEL_VARIANT } from './attendancePolicy'
import { AdherencePointsHeader, AdherenceStandingHeader } from './AdherencePolicyTooltips'
import type {
  AdherenceAgentRow, AdherenceOccurrence, AdherencePointBand, AdherenceWarningLevel, ComplianceThresholds,
} from '@/services/insightsAdherenceService'
import {
  KIND_LABEL, kindCategory, fmtCount, fmtPoints, fmtPct, compVariant,
  fmtDate, overage, mmss, timeRange,
} from './adherenceRosterFormat'

// Header and body share one template so the columns line up without a real table.
// Fewer columns than before (counts stay split, points are combined) so the font
// can breathe and it still fits one page wide.
// Agent | Punch: Start Long Miss | Phone: Start Stop | Points: 0-30 31-60 61-90 Total | Adherence | Standing
const GRID =
  'grid grid-cols-[minmax(160px,1.5fr)_46px_46px_46px_20px_46px_46px_24px_54px_54px_54px_62px_84px_112px] gap-x-2 items-center'

/** Integer % keeps the adherence pills narrow enough to fit on one line. */
const compactPct = (pct: number | null): string => (pct === null ? '—' : `${Math.round(pct)}%`)

/** The four combined-point cells (0-30 / 31-60 / 61-90 / Total). A fragment, so
 *  the spans land directly in the parent grid. */
const ptsCells = (b0: number, b31: number, b61: number, total: number) => (
  <>
    <span className="text-right tabular-nums text-slate-500 text-[13px]">{fmtPoints(b0)}</span>
    <span className="text-right tabular-nums text-slate-500 text-[13px]">{fmtPoints(b31)}</span>
    <span className="text-right tabular-nums text-slate-500 text-[13px]">{fmtPoints(b61)}</span>
    <span className="text-right tabular-nums font-semibold text-slate-900 text-[13px]">{fmtPoints(total)}</span>
  </>
)

/** A right-aligned RYG adherence pill inside its grid cell. */
const compCell = (pct: number | null, t: ComplianceThresholds) => (
  <span className="justify-self-end">
    <StatusBadge label={compactPct(pct)} variant={compVariant(pct, t)} className="text-[11px]" />
  </span>
)

interface RosterProps {
  rows: AdherenceAgentRow[]
  /** Occurrence detail per userId, fetched lazily as rows expand. */
  detail: Record<number, AdherenceOccurrence[] | undefined>
  onExpand: (userId: number) => void
  /** Report-only until an admin switches points on from a chosen date. */
  pointsActive: boolean
  /** Admin-tunable red/yellow/green cut-offs for the compliance cells. */
  thresholds: ComplianceThresholds
  /** Point bands and discipline ladder in force, for the header tooltips. */
  bands: AdherencePointBand[]
  levels: AdherenceWarningLevel[]
}

export default function AdherencePointsRoster({ rows, detail, onExpand, pointsActive, thresholds, bands, levels }: RosterProps) {
  const [expanded, setExpanded] = useState<number | null>(null)

  const toggle = (userId: number) => {
    const next = expanded === userId ? null : userId
    setExpanded(next)
    if (next !== null) onExpand(next)
  }

  // Department, then worst-first: points when they count, otherwise total
  // deviations, so the row a manager needs to see is always the first one.
  const totalEvents = (r: AdherenceAgentRow) =>
    r.durationEvents + r.startEvents + r.phoneEvents + r.missedEvents
  const sorted = [...rows].sort(
    (a, b) =>
      a.dept.localeCompare(b.dept) ||
      (pointsActive ? b.rolling90 - a.rolling90 : totalEvents(b) - totalEvents(a)) ||
      a.name.localeCompare(b.name),
  )

  if (sorted.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No scheduled days measured in this window.</p>
  }

  let lastDept = ''

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div className={cn(GRID, 'text-[11px] uppercase tracking-wide text-slate-400 px-3')}>
          <span />
          <span className="text-center border-b border-slate-200 pb-0.5" style={{ gridColumn: 'span 3' }}>
            Punch
          </span>
          <span />
          <span className="text-center border-b border-slate-200 pb-0.5" style={{ gridColumn: 'span 2' }}>
            Phone
          </span>
          <span />
          <span className="text-center border-b border-slate-200 pb-0.5" style={{ gridColumn: 'span 4' }}>
            <AdherencePointsHeader bands={bands} />
          </span>
          <span />
          <span />
        </div>
        <div className={cn(GRID, 'text-[11px] text-slate-400 border-b border-slate-200 pb-2 px-3')}>
          <span className="pl-6 text-xs">Agent</span>
          <span className="text-right">Start</span>
          <span className="text-right">Long</span>
          <span className="text-right">Miss</span>
          <span />
          <span className="text-right">Start</span>
          <span className="text-right">Stop</span>
          <span />
          <span className="text-right">0–30</span>
          <span className="text-right">31–60</span>
          <span className="text-right">61–90</span>
          <span className="text-right font-semibold text-slate-500">Total</span>
          <span className="text-right">Adherence</span>
          <span className="text-right"><AdherenceStandingHeader levels={levels} pointsActive={pointsActive} /></span>
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
                      <span className="text-slate-700 truncate text-sm">{r.name}</span>
                      <span className="text-right tabular-nums text-slate-600 text-sm">{fmtCount(r.startEvents)}</span>
                      <span className="text-right tabular-nums text-slate-600 text-sm">{fmtCount(r.durationEvents)}</span>
                      <span className="text-right tabular-nums text-slate-600 text-sm">{fmtCount(r.missedEvents)}</span>
                      <span />
                      <span className="text-right tabular-nums text-slate-600 text-sm">{fmtCount(r.phoneStartEvents)}</span>
                      <span className="text-right tabular-nums text-slate-600 text-sm">{fmtCount(r.phoneStopEvents)}</span>
                      <span />
                      {ptsCells(
                        r.punchPoints0to30 + r.phonePoints0to30,
                        r.punchPoints31to60 + r.phonePoints31to60,
                        r.punchPoints61to90 + r.phonePoints61to90,
                        r.punchPoints90 + r.phonePoints90,
                      )}
                      {compCell(r.totalAdherencePct, thresholds)}
                      <span className="text-right">
                        {!pointsActive
                          ? <StatusBadge label="Report-only" variant="neutral" className="text-[11px]" />
                          : r.levelKey
                            ? <StatusBadge label={r.level ?? ''} variant={LEVEL_VARIANT[r.levelKey] ?? 'warning'} className="text-[11px]" />
                            : <StatusBadge label="Clear" variant="good" className="text-[11px]" />}
                      </span>
                    </span>
                  }
                  detail={<RowDetail row={r} occurrences={detail[r.userId]} pointsActive={pointsActive} />}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RowDetail({ row, occurrences, pointsActive }: {
  row: AdherenceAgentRow
  occurrences?: AdherenceOccurrence[]
  pointsActive: boolean
}) {
  // Punch overage = gross over-schedule time of every break/lunch that ran long,
  // each segment independent (a short break never offsets a long one). Phone
  // overage = off-queue time outside each punched window.
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 text-[13px]">
        <Fact label="Punch Overage">{overage(row.punchOverrunSec, row.durationEvents)}</Fact>
        <Fact label="Phone Overage">{overage(row.phoneExtraSec, row.phoneEvents)}</Fact>
        <Fact label="Punch Adherence">{fmtPct(row.compliancePct)}</Fact>
        <Fact label="Phone Adherence">{fmtPct(row.phoneAdherencePct)}</Fact>
        <Fact label="Total Adherence">{fmtPct(row.totalAdherencePct)}</Fact>
        <Fact label="Punch Points">{fmtPoints(row.punchPoints90)}</Fact>
        <Fact label="Phone Points">{fmtPoints(row.phonePoints90)}</Fact>
        {pointsActive && (
          <>
            <Fact label="0–30 / 31–60 / 61–90">
              {`${fmtPoints(row.points0to30)} / ${fmtPoints(row.points31to60)} / ${fmtPoints(row.points61to90)}`}
            </Fact>
            <Fact label="Rolling 90 Pts">{row.rolling90.toFixed(2)}</Fact>
          </>
        )}
      </div>

      {occurrences === undefined ? (
        <p className="text-[12px] text-slate-400 pt-6">Loading detail…</p>
      ) : occurrences.length === 0 ? (
        <p className="text-[12px] text-slate-400 pt-6">No deviations in this window.</p>
      ) : (
        <div className="overflow-x-auto mt-6">
          <table className="w-full text-[12px] min-w-[780px]">
            <thead>
              <tr className="text-[11px] text-slate-400 border-b border-slate-200">
                <th className="text-left pb-1.5 font-medium">Date</th>
                <th className="text-left pb-1.5 font-medium">Category</th>
                <th className="text-left pb-1.5 font-medium">Type</th>
                <th className="text-center pb-1.5 font-medium">Scheduled</th>
                <th className="text-center pb-1.5 font-medium">Actual</th>
                <th className="text-center pb-1.5 font-medium">Phone Status</th>
                <th className="text-left pb-1.5 font-medium">Reason</th>
                <th className="text-center pb-1.5 font-medium">Deviation</th>
                <th className="text-right pb-1.5 font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {occurrences.map(o => (
                <tr key={`${o.workDate}-${o.kind}-${o.seq}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-500 whitespace-nowrap tabular-nums">{fmtDate(o.workDate)}</td>
                  <td className="py-1.5 text-slate-500 whitespace-nowrap">{kindCategory(o.kind)}</td>
                  <td className="py-1.5 text-slate-600 whitespace-nowrap">{KIND_LABEL[o.kind] ?? o.kind}</td>
                  <td className="py-1.5 text-center whitespace-nowrap tabular-nums text-slate-500">
                    {timeRange(o.scheduledStart, o.scheduledEnd)}
                  </td>
                  <td className="py-1.5 text-center whitespace-nowrap tabular-nums text-slate-600">
                    {timeRange(o.actualStart, o.actualEnd)}
                  </td>
                  <td className="py-1.5 text-center whitespace-nowrap tabular-nums text-slate-600">
                    {timeRange(o.phoneStart, o.phoneEnd)}
                  </td>
                  <td className="py-1.5 text-slate-600"><ReasonCell reason={o.reason} /></td>
                  <td className="py-1.5 text-center whitespace-nowrap tabular-nums text-slate-600">
                    {o.deviationSeconds > 0 ? mmss(o.deviationSeconds) : '—'}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap tabular-nums text-slate-700">
                    {o.counted
                      ? o.points.toFixed(2)
                      : <span className="text-slate-400">{o.points.toFixed(2)} (report)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Reason text with the approved-variance note broken out into an amber chip. The
 * adherence engine appends ' · exception +Xm begin/+Ym end' to a partially-
 * forgiven deviation's reason; a fully-forgiven one drops out of points entirely
 * (its audit trail is the adherence_exception row itself).
 */
function ReasonCell({ reason }: { reason: string }) {
  const marker = ' · exception '
  const at = reason.indexOf(marker)
  if (at < 0) return <>{reason}</>
  const base = reason.slice(0, at)
  const note = reason.slice(at + marker.length)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span>{base}</span>
      <span className="inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
        Exception {note}
      </span>
    </span>
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
