/**
 * CSR Adherence — rolling 90-day break/lunch adherence points and phone-vs-punch
 * matching. Second page of the "CSR Agent Activity" section, built the same way as
 * CSR Attendance (ActivityReportShell -> stacked InsightsSection blocks) so the
 * two read as siblings.
 *
 * While points are still in the report-only phase the page shows the behaviour and
 * a banner instead of live points, matching what the backend returns — nobody is
 * surprised the day the switch is flipped.
 *
 * Discipline Pipeline is derived from the same rows the roster renders, so it can
 * never disagree with the table above it.
 */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { InsightsSection, StatusBadge } from '@/components/insights'
import AdherencePointsRoster from '@/components/insights/AdherencePointsRoster'
import { LEVEL_VARIANT } from '@/components/insights/attendancePolicy'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import { useActivityFilters } from '@/hooks/useActivityFilters'
import { getAdherenceSummary, getAdherenceOccurrences } from '@/services/insightsAdherenceService'
import type { AdherenceAgentRow, AdherenceOccurrence } from '@/services/insightsAdherenceService'

/** 'YYYY-MM-DD' -> 'MM-DD-YYYY', split rather than parsed to avoid a TZ shift. */
function fmtMdy(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${m}-${d}-${y}`
}

const pct = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}%`)

type Tone = 'good' | 'warning' | 'bad' | 'neutral'
function tone(n: number | null, t: { greenMin: number; yellowMin: number }): Tone {
  if (n === null) return 'neutral'
  if (n >= t.greenMin) return 'good'
  if (n >= t.yellowMin) return 'warning'
  return 'bad'
}
const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-600',
  warning: 'text-orange-600',
  bad: 'text-red-600',
  neutral: 'text-slate-900',
}

export default function CSRAdherencePage() {
  const filters = useActivityFilters('aa-adherence-filters')
  const queryClient = useQueryClient()
  const [detail, setDetail] = useState<Record<number, AdherenceOccurrence[] | undefined>>({})

  const summaryQ = useQuery({
    queryKey: ['csr-adherence-summary', filters.params],
    queryFn: () => getAdherenceSummary(filters.params),
    staleTime: 0,
  })

  // Occurrence detail is fetched only when a row is opened — 90 days of detail for
  // everyone would be a large payload nobody reads.
  const loadDetail = useCallback((userId: number) => {
    if (detail[userId] !== undefined) return
    queryClient
      .fetchQuery({
        queryKey: ['csr-adherence-occurrences', userId, filters.params],
        queryFn: () => getAdherenceOccurrences(userId, filters.params),
      })
      .then(res => setDetail(prev => ({ ...prev, [userId]: res.occurrences })))
      .catch(() => setDetail(prev => ({ ...prev, [userId]: [] })))
  }, [detail, filters.params, queryClient])

  const rows = useMemo(() => summaryQ.data?.rows ?? [], [summaryQ.data])
  const levels = useMemo(() => summaryQ.data?.warningLevels ?? [], [summaryQ.data])
  const bands = useMemo(() => summaryQ.data?.pointBands ?? [], [summaryQ.data])
  const isSelf = summaryQ.data?.isSelfView ?? false
  const pointsActive = summaryQ.data?.pointsActive ?? false
  const thresholds = summaryQ.data?.complianceThresholds ?? { greenMin: 90, yellowMin: 80 }
  const pipeline = useMemo(() => summarisePipeline(rows, levels), [rows, levels])

  const asOf = summaryQ.data?.asOf
  const windowFrom = summaryQ.data?.windowFrom
  const currentDateRange = windowFrom && asOf ? { start: fmtMdy(windowFrom), end: fmtMdy(asOf) } : undefined

  const { period, customStart, customEnd, setPeriod, setCustomStart, setCustomEnd } = filters
  useEffect(() => {
    if (!windowFrom || !asOf) return
    if (period === 'Custom' && customStart === windowFrom && customEnd === asOf) return
    setPeriod('Custom')
    setCustomStart(windowFrom)
    setCustomEnd(asOf)
  }, [windowFrom, asOf, period, customStart, customEnd, setPeriod, setCustomStart, setCustomEnd])

  return (
    <ActivityReportShell
      title="Adherence"
      description="Rolling 90-day break/lunch adherence: duration and start-time against the published schedule, plus phone-status-vs-punch matching."
      filters={filters}
      availableUsers={summaryQ.data?.availableUsers ?? []}
      availableDepts={summaryQ.data?.availableDepartments ?? []}
      currentDateRange={currentDateRange}
      live
      hideBusinessDays
    >
      {!pointsActive && (
        <p className="text-[12px] text-neutral-700 bg-surface border border-warning/40 rounded-lg px-3 py-2">
          Report-only mode. Deviations below are being tracked but do not yet count toward the discipline ladder.
          An admin switches points on from a chosen date in Admin → List Management → Adherence.
        </p>
      )}

      {summaryQ.data?.asOfClamped && asOf && (
        <p className="text-[12px] text-slate-500 bg-surface border border-slate-200 rounded-lg px-3 py-2">
          Showing the 90 days ending <span className="font-medium text-slate-700">{asOf}</span>, the latest date with
          punch data.
        </p>
      )}

      {isSelf && rows.slice(0, 1).map(r => (
        <div key={r.userId} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SelfTile label="Total Adherence" value={pct(r.totalAdherencePct)} tone={tone(r.totalAdherencePct, thresholds)} />
          <SelfTile label="Punch Adherence" value={pct(r.compliancePct)} tone={tone(r.compliancePct, thresholds)} />
          <SelfTile label="Phone Adherence" value={pct(r.phoneAdherencePct)} tone={tone(r.phoneAdherencePct, thresholds)} />
          <SelfTile label="Standing" value={pointsActive ? (r.level ?? 'Clear') : 'Report-only'} />
        </div>
      ))}

      <InsightsSection title="Adherence Points">
        {summaryQ.isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
        ) : summaryQ.isError ? (
          <p className="text-sm text-danger text-center py-6">Couldn't load adherence. Refresh to try again.</p>
        ) : (
          <AdherencePointsRoster
            rows={rows}
            detail={detail}
            onExpand={loadDetail}
            pointsActive={pointsActive}
            thresholds={thresholds}
            bands={bands}
            levels={levels}
          />
        )}
      </InsightsSection>

      {!isSelf && pointsActive && (
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
          </div>
        </InsightsSection>
      )}
    </ActivityReportShell>
  )
}

function SelfTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${TONE_TEXT[tone]}`}>{value}</p>
    </div>
  )
}

interface PipelineRung {
  levelKey: string
  label: string
  pointsThreshold: number
  names: string[]
}

function summarisePipeline(
  rows: AdherenceAgentRow[],
  levels: Array<{ levelKey: string; label: string; pointsThreshold: number }>,
): PipelineRung[] {
  const ladder = [...levels].sort((a, b) => b.pointsThreshold - a.pointsThreshold)
  return ladder.map(l => ({
    ...l,
    names: rows.filter(r => r.levelKey === l.levelKey).map(r => r.name).sort(),
  }))
}
