import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  InsightsFilterBar, InsightsSection, KpiTile, StatRow,
  TrendChart, ScoreHistogram, StatusBadge, StatusDot,
  QCPageSkeleton, ErrorCard,
} from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import {
  getQCKpis, getQCTrends, getScoreDistribution, getCategoryScores,
  getMissedQuestions, getQualityDeptComparison, getFormScores,
} from '@/services/insightsQCService'
import departmentService from '@/services/departmentService'
import QCMissedQuestions from './QCMissedQuestions'
import { KPI_DEFS } from '@/constants/kpiDefs'

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

function scoreStatus(score: number | null, goal = 90): 'good' | 'warning' | 'bad' {
  if (score === null) return 'warning'
  if (score >= goal)       return 'good'
  if (score >= goal - 10)  return 'warning'
  return 'bad'
}

export default function QCQualityPage() {
  const navigate = useNavigate()
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd, params } = useQCFilters()
  const [selectedFormId, setSelectedFormId]     = useState<number | null>(null)
  const [selectedFormName, setSelectedFormName] = useState<string>('All Forms')
  const [selectedForms, setSelectedForms]       = useState<string[]>([])

  const { data: deptsData } = useQuery({
    queryKey: ['dept-list-filter'],
    queryFn:  () => departmentService.getDepartments(1, 100, { is_active: true }),
    staleTime: 10 * 60 * 1000,
  })
  const deptOptions = deptsData?.items.map(d => d.department_name) ?? []
  const nameToId    = useMemo(() =>
    Object.fromEntries((deptsData?.items ?? []).map(d => [d.department_name, d.id])),
  [deptsData])

  const apiParams = useMemo(() => ({
    ...params,
    departments: departments.length
      ? departments.map(n => nameToId[n]).filter(Boolean).join(',')
      : undefined,
  }), [params, departments, nameToId])

  const catParams = useMemo(() => ({ ...apiParams, ...(selectedFormId ? { form: selectedFormId } : {}) }), [apiParams, selectedFormId])

  const { data: kpiData, isLoading, isError, refetch } = useQuery({ queryKey: ['qc-kpis', apiParams], queryFn: () => getQCKpis(apiParams) })
  const { data: trendData } = useQuery({ queryKey: ['qc-trends-qa', apiParams], queryFn: () => getQCTrends({ ...apiParams, kpis: 'avg_qa_score' }) })
  const { data: distData = [] } = useQuery({ queryKey: ['qc-dist', apiParams, selectedForms], queryFn: () => getScoreDistribution({ ...apiParams, forms: selectedForms.join(',') || undefined }) })
  const { data: catData  = [] } = useQuery({ queryKey: ['qc-cats', catParams], queryFn: () => getCategoryScores(catParams) })
  const { data: missData = [] } = useQuery({ queryKey: ['qc-miss', apiParams], queryFn: () => getMissedQuestions(apiParams) })
  const { data: deptComp = [] } = useQuery({ queryKey: ['qc-dept-cmp', apiParams], queryFn: () => getQualityDeptComparison(apiParams) })
  const { data: formScores = [] } = useQuery({ queryKey: ['qc-forms', apiParams], queryFn: () => getFormScores(apiParams) })

  const cur = kpiData?.current ?? {}
  const prv = kpiData?.prior   ?? {}
  const qaTrends = trendData?.map(r => ({ label: String(r.label ?? ''), value: Number(r['avg_qa_score'] ?? 0) })) ?? []

  const auditGoal    = KPI_DEFS['avg_qa_score']?.goal ?? 90
  const disputeGoal  = KPI_DEFS['dispute_rate']?.goal ?? 5
  const auditTimeGoal   = KPI_DEFS['time_to_audit']?.goal ?? 3
  const coachTimeGoal   = KPI_DEFS['time_to_coaching']?.goal ?? 5

  return (
    <div>
      <div className="-mx-6 -mt-6 mb-5">
        <InsightsFilterBar
          selectedDepts={departments} onDeptsChange={setDepartments}
          availableDepts={deptOptions}
          period={period} onPeriodChange={setPeriod}
          customStart={customStart} customEnd={customEnd}
          onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
          showFormFilter selectedForms={selectedForms} onFormsChange={setSelectedForms}
          availableForms={formScores.map(f => f.form)}
        />
      </div>

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
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined} />
          ))}
        </div>

        {/* KPI Row 2 — disputes */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {['dispute_rate','dispute_upheld_rate','dispute_not_upheld_rate','dispute_adjusted_rate','avg_dispute_resolution_time'].map(code => (
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined} />
          ))}
        </div>

        {/* KPI Row 3 */}
        <div className="grid grid-cols-2 gap-3 max-w-lg">
          {['time_to_audit','qa_score_trend'].map(code => (
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined} />
          ))}
        </div>

        {/* Trend + Distribution charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="QA Score Trend" description="6-month rolling average QA score">
            <TrendChart data={qaTrends} color="#00aeef" goalValue={90} height={120} metricLabel="%" />
          </InsightsSection>
          <InsightsSection title="Score Distribution">
            <ScoreHistogram data={distData} goalScore={90} />
          </InsightsSection>
        </div>

        {/* Dispute Analysis + Timeliness */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="Dispute Analysis">
            <StatRow label="Dispute Rate"         value={fmt(cur.dispute_rate, '%')}          valueColor={(cur.dispute_rate ?? 0) > disputeGoal ? 'text-red-600' : 'text-emerald-600'} />
            <StatRow label="Upheld Rate"          value={fmt(cur.dispute_upheld_rate, '%')} />
            <StatRow label="Rejected Rate"        value={fmt(cur.dispute_not_upheld_rate, '%')} />
            <StatRow label="Adjusted Rate"        value={fmt(cur.dispute_adjusted_rate, '%')} />
            <StatRow label="Avg Resolution Time"  value={fmt(cur.avg_dispute_resolution_time, ' days')} />
          </InsightsSection>
          <InsightsSection title="Timeliness">
            <StatRow label="Avg Time to Audit"     value={fmt(cur.time_to_audit, ' days')} />
            <StatRow label="Target Audit Time"     value={`${auditTimeGoal} days`}    valueColor="text-slate-400" />
            <StatRow label="Avg Time to Coaching"  value={fmt(cur.time_to_coaching, ' days')} />
            <StatRow label="Target Coaching Time"  value={`${coachTimeGoal} days`}    valueColor="text-slate-400" />
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
                    const st    = scoreStatus(row.avgScore, auditGoal)
                    const isSelected = selectedFormId === row.id
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${isSelected ? 'bg-[#00aeef]/5 border-l-2 border-l-[#00aeef]' : 'hover:bg-slate-50'}`}
                        onClick={() => {
                          if (isSelected) { setSelectedFormId(null); setSelectedFormName('All Forms') }
                          else { setSelectedFormId(row.id); setSelectedFormName(row.form) }
                        }}
                      >
                        <td className="py-2.5 pr-4 font-medium text-slate-800">{row.form}</td>
                        <td className="py-2.5 pr-4 text-slate-500">{row.submissions}</td>
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center gap-1.5">
                            <StatusDot value={row.avgScore ?? 0} thresholds={{ direction: 'UP_IS_GOOD', goal: auditGoal, warn: auditGoal - 10, crit: auditGoal - 20 }} />
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

        {/* Category Performance */}
        <InsightsSection title={`Category Performance — ${selectedFormName}`}>
          {catData.length === 0
            ? <p className="text-sm text-slate-400 text-center py-4">No category data for the selected form.</p>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 border-b border-slate-200">
                    {['Category','Audits','Avg Score','vs Goal','Status'].map(h => (
                      <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catData.map(row => {
                    const delta = row.avgScore != null ? row.avgScore - auditGoal : null
                    const st    = scoreStatus(row.avgScore, auditGoal)
                    return (
                      <tr key={row.category} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-slate-800">{row.category}</td>
                        <td className="py-2.5 pr-4 text-slate-500">{row.audits}</td>
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center gap-1.5">
                            <StatusDot value={row.avgScore ?? 0} thresholds={{ direction: 'UP_IS_GOOD', goal: auditGoal, warn: auditGoal - 10, crit: auditGoal - 20 }} />
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
                          <StatusDot value={row.avgScore ?? 0} thresholds={{ direction: 'UP_IS_GOOD', goal: auditGoal, warn: auditGoal - 10, crit: auditGoal - 20 }} />
                          <span className="font-semibold">{fmt(row.avgScore, '%')}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">{row.disputes}</td>
                      <td className="py-2.5">
                        <StatusBadge
                          label={scoreStatus(row.avgScore) === 'good' ? 'On Track' : scoreStatus(row.avgScore) === 'warning' ? 'Near Goal' : 'Below Goal'}
                          variant={scoreStatus(row.avgScore) === 'bad' ? 'bad' : scoreStatus(row.avgScore) === 'warning' ? 'warning' : 'good'}
                        />
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
