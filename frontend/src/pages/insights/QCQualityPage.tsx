import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  InsightsFilterBar, InsightsSection, KpiTile, StatRow,
  TrendChart, ScoreHistogram, StatusBadge, StatusDot,
  QCPageSkeleton, ErrorCard,
} from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import {
  getQCKpis, getQCTrends, getScoreDistribution, getCategoryScores,
  getMissedQuestions, getQualityDeptComparison, getFormScores, getFilterOptions,
} from '@/services/insightsQCService'
import QCMissedQuestions from './QCMissedQuestions'

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

function scoreStatus(
  score: number | null,
  goal: number | null,
  warn: number | null,
): 'good' | 'warning' | 'bad' {
  if (score === null || goal === null) return 'warning'
  if (score >= goal) return 'good'
  if (warn != null && score >= warn) return 'warning'
  return 'bad'
}

function CategoryPerformance({ catData, auditGoal, auditWarn, qaThresh }: {
  catData: Array<{ category: string; form: string; audits: number; avgScore: number | null; priorScore: number | null }>
  auditGoal: number
  auditWarn: number | null
  qaThresh: { goal: number | null; warn: number | null; crit: number | null; direction: string }
}) {
  const [showAll, setShowAll] = useState(false)
  const sorted = [...catData].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))
  const visible = showAll ? sorted : sorted.slice(0, 5)

  return (
    <InsightsSection title="Category Performance">
      {catData.length === 0
        ? <p className="text-sm text-slate-400 text-center py-4">No category data for the selected period.</p>
        : (<>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200">
                {['Category','Form','Audits','Avg Score','Trend','vs Goal','Status'].map(h => (
                  <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => {
                const delta = row.avgScore != null ? row.avgScore - auditGoal : null
                const st    = scoreStatus(row.avgScore, auditGoal, auditWarn)
                const trend = row.avgScore != null && row.priorScore != null ? row.avgScore - row.priorScore : null
                return (
                  <tr key={`${row.form}-${row.category}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{row.category}</td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs">{row.form}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{row.audits}</td>
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5">
                        <StatusDot value={row.avgScore ?? 0} thresholds={qaThresh} />
                        <span className="font-semibold">{fmt(row.avgScore, '%')}</span>
                      </span>
                    </td>
                    <td className={`py-2.5 pr-4 text-xs font-medium ${
                      trend === null ? 'text-slate-400' :
                      trend > 0 ? 'text-emerald-600' :
                      trend < 0 ? 'text-red-500' : 'text-slate-400'
                    }`}>
                      {trend === null ? '—' :
                       trend === 0 ? '— flat' :
                       `${trend > 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(1)}%`}
                    </td>
                    <td className={`py-2.5 pr-4 font-medium ${delta != null && delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {delta != null ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—'}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge label={st === 'good' ? 'On Track' : st === 'warning' ? 'Near Goal' : 'Below Goal'} variant={st === 'bad' ? 'bad' : st === 'warning' ? 'warning' : 'good'} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-3 text-xs text-primary hover:underline"
            >
              {showAll ? 'Show bottom 5 only' : `Show all ${sorted.length} categories`}
            </button>
          )}
        </>)
      }
    </InsightsSection>
  )
}

export default function QCQualityPage() {
  const navigate = useNavigate()
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          forms, setForms, resetFilters, params } = useQCFilters()

  // Cross-filtered dropdown options: dept options filtered by selected forms, form options filtered by selected depts
  const { data: filterOpts } = useQuery({
    queryKey: ['qc-filter-opts', params],
    queryFn:  () => getFilterOptions(params),
  })
  const deptOptions = filterOpts?.departments ?? []
  const formOptions = filterOpts?.forms ?? []

  // All data queries use the same params (dept + form + period)
  const { data: kpiData, isLoading, isError, refetch } = useQuery({ queryKey: ['qc-kpis', params], queryFn: () => getQCKpis(params) })
  const { data: trendData } = useQuery({ queryKey: ['qc-trends-qa', params], queryFn: () => getQCTrends({ ...params, kpis: 'avg_qa_score' }) })
  const { data: distData = [] } = useQuery({ queryKey: ['qc-dist', params], queryFn: () => getScoreDistribution(params) })
  const { data: catData  = [] } = useQuery({ queryKey: ['qc-cats', params], queryFn: () => getCategoryScores(params) })
  const { data: missData = [] } = useQuery({ queryKey: ['qc-miss', params], queryFn: () => getMissedQuestions(params) })
  const { data: deptComp = [] } = useQuery({ queryKey: ['qc-dept-cmp', params], queryFn: () => getQualityDeptComparison(params) })
  const { data: formScores = [] } = useQuery({ queryKey: ['qc-forms', params], queryFn: () => getFormScores(params) })
  const { data: kpiConfig } = useKpiConfig()

  const cur       = kpiData?.current   ?? {}
  const prv       = kpiData?.prior     ?? {}
  const meta      = kpiData?.meta
  const priorMeta = kpiData?.priorMeta
  const qaTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: r['avg_qa_score'] != null ? Number(r['avg_qa_score']) : null })) ?? []

  // All thresholds resolved from ie_kpi_threshold (kpiDefs.ts as fallback)
  const qaThresh  = resolveThresholds('avg_qa_score', kpiConfig)
  const auditGoal = qaThresh.goal ?? 90
  const auditWarn = qaThresh.warn ?? null

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments}
        availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        showFormFilter selectedForms={forms} onFormsChange={setForms}
        availableForms={formOptions}
        businessDays={meta?.businessDays} priorBusinessDays={priorMeta?.businessDays}
        priorDateRange={priorMeta?.startDate ? { start: priorMeta.startDate, end: priorMeta.endDate } : undefined}
        onReset={resetFilters}
      />

      {isLoading && <QCPageSkeleton tiles={5} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quality Deep Dive</h1>
          <p className="text-sm text-slate-500 mt-0.5">Detailed quality analytics — scores, disputes, categories, and missed questions.</p>
        </div>

        {/* KPI Row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {['avg_qa_score','audits_assigned','audits_completed','audit_completion_rate','critical_fail_rate'].map(code => (
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined}
              thresholds={resolveThresholds(code, kpiConfig)} />
          ))}
        </div>

        {/* Trend + Distribution charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="QA Score Trend">
            <TrendChart data={qaTrends} color="#00aeef" goalValue={auditGoal} height={120} metricLabel="%" />
          </InsightsSection>
          <InsightsSection title="Score Distribution">
            <ScoreHistogram data={distData} goalScore={auditGoal} />
          </InsightsSection>
        </div>

        {/* Dispute Analysis + Timeliness */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="Dispute Analysis">
            {([
              ['Dispute Rate',                 'dispute_rate',           cur.dispute_rate,           prv.dispute_rate,           '%'],
              ['Upheld (Original Score Kept)',  'dispute_upheld_rate',   cur.dispute_upheld_rate,    prv.dispute_upheld_rate,    '%'],
              ['Adjusted (Score Changed)',      'dispute_adjusted_rate', cur.dispute_adjusted_rate,  prv.dispute_adjusted_rate,  '%'],
            ] as [string, string, number | null | undefined, number | null | undefined, string][]).map(([lbl, code, curVal, prvVal, sfx]) => {
              const th = resolveThresholds(code, kpiConfig)
              return (
                <StatRow key={code} label={lbl}
                  value={fmt(curVal ?? null, '%')}
                  trend={{ current: curVal ?? null, prior: prvVal ?? null, direction: th.direction as 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL', suffix: sfx }}
                  thresholds={{ goal: th.goal, warn: th.warn, crit: th.crit, direction: th.direction, suffix: '%' }}
                />
              )
            })}
          </InsightsSection>
          <InsightsSection title="Timeliness">
            {([
              ['Avg Time to Audit',            'time_to_audit',                 cur.time_to_audit,                 prv.time_to_audit],
              ['Avg Dispute Resolution Time',  'avg_dispute_resolution_time',   cur.avg_dispute_resolution_time,   prv.avg_dispute_resolution_time],
            ] as [string, string, number | null | undefined, number | null | undefined][]).map(([lbl, code, curVal, prvVal]) => {
              const th = resolveThresholds(code, kpiConfig)
              return (
                <StatRow key={code} label={lbl}
                  value={fmt(curVal ?? null, ' days')}
                  trend={{ current: curVal ?? null, prior: prvVal ?? null, direction: th.direction as 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL', suffix: 'd' }}
                  thresholds={{ goal: th.goal, warn: th.warn, crit: th.crit, direction: th.direction, suffix: ' days' }}
                />
              )
            })}
          </InsightsSection>
        </div>

        {/* Average Score by Form */}
        <InsightsSection title="Average Score by Form">
          {formScores.length === 0
            ? <p className="text-sm text-slate-400 text-center py-4">No form data for this period.</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-200">
                    {['Form','Submissions','Avg Score','vs Goal','Status'].map(h => (
                      <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {formScores.map(row => {
                    const delta = row.avgScore != null ? row.avgScore - auditGoal : null
                    const st    = scoreStatus(row.avgScore, auditGoal, auditWarn)
                    const isSelected = forms.includes(row.form)
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-slate-50'}`}
                        onClick={() => {
                          if (isSelected) setForms(forms.filter(f => f !== row.form))
                          else setForms([...forms, row.form])
                        }}
                      >
                        <td className="py-2.5 pr-4 font-medium text-slate-800">{row.form}</td>
                        <td className="py-2.5 pr-4 text-slate-500">{row.submissions}</td>
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center gap-1.5">
                            <StatusDot value={row.avgScore ?? 0} thresholds={qaThresh} />
                            <span className="font-semibold">{fmt(row.avgScore, '%')}</span>
                          </span>
                        </td>
                        <td className={`py-2.5 pr-4 font-medium ${delta != null && delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {delta != null ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—'}
                        </td>
                        <td className="py-2.5">
                          <StatusBadge label={st === 'good' ? 'On Track' : st === 'warning' ? 'Near Goal' : 'Below Goal'} variant={st === 'bad' ? 'bad' : st === 'warning' ? 'warning' : 'good'} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          }
        </InsightsSection>

        {/* Category Performance — bottom 5 by default */}
        <CategoryPerformance
          catData={catData} auditGoal={auditGoal} auditWarn={auditWarn} qaThresh={qaThresh}
        />

        {/* Top Missed Questions */}
        <QCMissedQuestions questions={missData} />

        {/* Department Comparison */}
        <InsightsSection title="Department Comparison">
          {deptComp.length === 0
            ? <p className="text-sm text-slate-400 text-center py-4">No data available.</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-200">
                    {['Department','Audits','QA Score','Disputes','Status'].map(h => (
                      <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptComp.map(row => (
                    <tr
                      key={row.dept}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setDepartments([row.dept]) }}
                    >
                      <td className="py-2.5 pr-4 font-medium text-slate-800">{row.dept}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{row.audits}</td>
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-1.5">
                          <StatusDot value={row.avgScore ?? 0} thresholds={qaThresh} />
                          <span className="font-semibold">{fmt(row.avgScore, '%')}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.disputes}</td>
                      <td className="py-2.5">
                        {(() => { const st = scoreStatus(row.avgScore, auditGoal, auditWarn); return (
                          <StatusBadge
                            label={st === 'good' ? 'On Track' : st === 'warning' ? 'Near Goal' : 'Below Goal'}
                            variant={st === 'bad' ? 'bad' : st === 'warning' ? 'warning' : 'good'}
                          />
                        )})()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>
      </div>}
    </div>
  )
}
