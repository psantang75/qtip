/**
 * CSR Attendance — rolling 90-day attendance points and schedule compliance.
 * First page of the "CSR Agent Activity" section.
 *
 * Structure follows the Agent Activity reports exactly (ActivityReportShell ->
 * stacked InsightsSection blocks) rather than inventing a layout.
 *
 * KPI tiles appear ONLY in the self view. Across a group they would average away
 * the thing the page exists to surface: a department mean of 2.1 points hides the
 * one person sitting on 9. The roster is the group answer.
 *
 * Discipline Pipeline and Perfect Attendance are derived from the same rows the
 * roster renders, so they cannot disagree with it. The policy behind the numbers
 * — point bands and the discipline ladder — lives in the roster's own column
 * header tooltips rather than in a card of its own.
 */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { InsightsSection, AttendanceMatrix, StatusBadge } from '@/components/insights'
import AttendancePointsRoster from '@/components/insights/AttendancePointsRoster'
import { LEVEL_VARIANT } from '@/components/insights/AttendancePolicyTooltips'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import {
  getAttendanceSummary, getAttendanceOccurrences, getAttendanceCompliance,
} from '@/services/insightsCsrService'
import type { AttendanceAgentRow, AttendanceOccurrence } from '@/services/insightsCsrService'

const COMPLIANCE_MONTHS = 6

/** 'YYYY-MM-DD' -> 'MM-DD-YYYY'. Split, never parsed as a Date, so a date near
 *  midnight is not shifted a day west of Greenwich. */
function fmtMdy(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${m}-${d}-${y}`
}

export default function CSRAttendancePage() {
  // Own storage key: this report drives the filter bar to a Custom rolling-90
  // range, which must not leak onto the sales reports that share the default key.
  const filters = useActivityFilters('aa-attendance-filters')
  const queryClient = useQueryClient()
  const { data: kpiConfig } = useKpiConfig()
  const [detail, setDetail] = useState<Record<number, AttendanceOccurrence[] | undefined>>({})

  const summaryQ = useQuery({
    queryKey: ['csr-attendance-summary', filters.params],
    queryFn: () => getAttendanceSummary(filters.params),
    staleTime: 0,
  })

  const complianceQ = useQuery({
    queryKey: ['csr-attendance-compliance', filters.params],
    queryFn: () => getAttendanceCompliance({ ...filters.params, months: COMPLIANCE_MONTHS }),
    staleTime: 0,
  })

  // Occurrence detail is fetched only when a row is opened. Ninety days of detail
  // for everyone would be a large payload nobody reads.
  const loadDetail = useCallback((userId: number) => {
    if (detail[userId] !== undefined) return
    queryClient
      .fetchQuery({
        queryKey: ['csr-attendance-occurrences', userId, filters.params],
        queryFn: () => getAttendanceOccurrences(userId, filters.params),
      })
      .then(res => setDetail(prev => ({ ...prev, [userId]: res.occurrences })))
      .catch(() => setDetail(prev => ({ ...prev, [userId]: [] })))
  }, [detail, filters.params, queryClient])

  const rows = summaryQ.data?.rows ?? []
  const levels = summaryQ.data?.warningLevels ?? []
  const complianceThresholds = resolveThresholds('csr_att_compliance', kpiConfig)

  const pipeline = useMemo(() => summarisePipeline(rows, levels), [rows, levels])
  const perfect = useMemo(
    () => rows.filter(r => r.rolling90 === 0 && r.graceUsed === 0).sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  )

  const asOf = summaryQ.data?.asOf
  const windowFrom = summaryQ.data?.windowFrom
  const isSelf = summaryQ.data?.isSelfView ?? false

  // The rolling window covers the whole page, so it belongs in the filter bar's
  // Date Range row (like the other Insights reports) rather than above the roster.
  // Pre-formatted MM-DD-YYYY to match how the filter bar renders margin's range.
  const currentDateRange = windowFrom && asOf
    ? { start: fmtMdy(windowFrom), end: fmtMdy(asOf) }
    : undefined

  // Reflect reality in the filter bar: this is a rolling 90-day report, not a
  // month, so the Period must read "Custom" over the actual window the backend
  // returned (floored to the 2026-06-21 policy start until 90 days have passed,
  // then rolling forward on its own). Driving it from the response keeps the
  // Period, the Custom date inputs and the Date Range row from ever disagreeing.
  const { period, customStart, customEnd, setPeriod, setCustomStart, setCustomEnd } = filters
  useEffect(() => {
    if (!windowFrom || !asOf) return
    if (period === 'Custom' && customStart === windowFrom && customEnd === asOf) return
    setPeriod('Custom')
    setCustomStart(windowFrom)
    setCustomEnd(asOf)
  }, [windowFrom, asOf, period, customStart, customEnd, setPeriod, setCustomStart, setCustomEnd])

  // Grace is the gap below the lowest late band, so it is derived from the bands
  // in force rather than configured separately. Reading it from the response keeps
  // the Grace tooltip honest after somebody edits a band.
  const graceCeiling = useMemo(() => {
    const lateMins = (summaryQ.data?.pointBands ?? [])
      .filter(b => b.kind === 'LATE')
      .map(b => b.minSeconds)
    return lateMins.length > 0 ? Math.min(...lateMins) - 1 : null
  }, [summaryQ.data?.pointBands])

  return (
    <ActivityReportShell
      title="Attendance"
      description="Rolling 90-day attendance points and schedule adherence by agent, since the 06-21-2026 policy start."
      filters={filters}
      availableUsers={summaryQ.data?.availableUsers ?? []}
      availableDepts={summaryQ.data?.availableDepartments ?? []}
      currentDateRange={currentDateRange}
      live
      hideBusinessDays
    >
      {summaryQ.data?.asOfClamped && asOf && (
        <p className="text-[12px] text-slate-500 bg-surface border border-slate-200 rounded-lg px-3 py-2">
          Showing the 90 days ending <span className="font-medium text-slate-700">{asOf}</span>, the latest date with
          punch data. Later days in your selected period have no actuals to compare the schedule against.
        </p>
      )}

      {isSelf && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {rows.slice(0, 1).map(r => (
            <SelfTiles key={r.userId} row={r} />
          ))}
        </div>
      )}

      <InsightsSection title="Attendance Points">
        {summaryQ.isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : summaryQ.isError ? (
          <p className="text-sm text-danger text-center py-6">Couldn't load attendance. Refresh to try again.</p>
        ) : (
          <AttendancePointsRoster
            rows={rows}
            detail={detail}
            onExpand={loadDetail}
            bands={summaryQ.data?.pointBands ?? []}
            levels={levels}
            graceCeilingSeconds={graceCeiling}
          />
        )}
      </InsightsSection>

      <InsightsSection title={`Schedule Adherence (last ${COMPLIANCE_MONTHS} months)`} infoKpiCodes={['csr_att_compliance']}>
        {complianceQ.isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : complianceQ.isError || !complianceQ.data ? (
          <p className="text-sm text-danger text-center py-6">Couldn't load adherence. Refresh to try again.</p>
        ) : (
          <AttendanceMatrix data={complianceQ.data} thresholds={complianceThresholds} />
        )}
      </InsightsSection>

      {!isSelf && (
        <InsightsSection title="Discipline Pipeline">
          <div className="space-y-2">
            {pipeline.map(p => (
              <div key={p.levelKey} className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg hover:bg-slate-50">
                <span className="flex items-center gap-2 min-w-0">
                  <StatusBadge label={p.label} variant={LEVEL_VARIANT[p.levelKey] ?? 'warning'} />
                  <span className="text-[12px] text-slate-400">{p.pointsThreshold}+ pts</span>
                </span>
                <span className="text-sm text-slate-600 truncate">
                  {p.names.length === 0 ? <span className="text-slate-300">None</span> : p.names.join(', ')}
                </span>
              </div>
            ))}
            <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between gap-3 px-4 py-2">
              <span className="flex items-center gap-2">
                <StatusBadge label="Perfect Attendance" variant="good" />
                <span className="text-[12px] text-slate-400">0 pts, no grace used</span>
              </span>
              <span className="text-sm text-slate-600 truncate">
                {perfect.length === 0 ? <span className="text-slate-300">None</span> : perfect.map(p => p.name).join(', ')}
              </span>
            </div>
          </div>
        </InsightsSection>
      )}
    </ActivityReportShell>
  )
}

function SelfTiles({ row }: { row: AttendanceAgentRow }) {
  const tiles: Array<[string, string]> = [
    ['Rolling 90 Points', row.rolling90.toFixed(2)],
    ['Schedule Adherence', row.compliancePct === null ? '—' : `${row.compliancePct.toFixed(1)}%`],
    ['Standing', row.level ?? 'Clear'],
    ['Next Roll-Off', row.rollOffDate ? `${row.rollOffPoints.toFixed(2)} on ${row.rollOffDate}` : 'None pending'],
  ]
  return (
    <>
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
        </div>
      ))}
    </>
  )
}

interface PipelineRung {
  levelKey: string
  label: string
  pointsThreshold: number
  names: string[]
}

/** Each person appears at their HIGHEST rung only, matching how discipline works. */
function summarisePipeline(
  rows: AttendanceAgentRow[],
  levels: Array<{ levelKey: string; label: string; pointsThreshold: number }>,
): PipelineRung[] {
  const ladder = [...levels].sort((a, b) => b.pointsThreshold - a.pointsThreshold)
  return ladder.map(l => ({
    ...l,
    names: rows.filter(r => r.levelKey === l.levelKey).map(r => r.name).sort(),
  }))
}
