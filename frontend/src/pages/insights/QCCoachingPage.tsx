import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { InsightsFilterBar, InsightsSection, KpiTile, StatusBadge, StatusDot, ExpandableRow, QCPageSkeleton, ErrorCard } from '@/components/insights'
import { useQCFilters } from '@/hooks/useQCFilters'
import {
  getQCKpis, getCoachingTopics, getCoachingTopicAgents, getRepeatOffenders,
  getQuizBreakdown, getAgentsFailedQuizzes, getCoachingDeptComparison,
} from '@/services/insightsQCService'
import departmentService from '@/services/departmentService'
import { KPI_DEFS } from '@/constants/kpiDefs'

function passColor(rate: number | null) {
  if (rate === null) return 'text-slate-500'
  if (rate >= 85) return 'text-emerald-600'
  if (rate >= 70) return 'text-orange-500'
  return 'text-red-600'
}
function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

export default function QCCoachingPage() {
  const navigate = useNavigate()
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd, params } = useQCFilters()
  const [expandedTopic,  setExpandedTopic]  = useState<string | null>(null)
  const [expandedAgent,  setExpandedAgent]  = useState<number | null>(null)

  const { data: deptsData } = useQuery({ queryKey: ['dept-list-filter'], queryFn: () => departmentService.getDepartments(1, 100, { is_active: true }), staleTime: 10 * 60 * 1000 })
  const deptOptions = deptsData?.items.map(d => d.department_name) ?? []
  const nameToId    = useMemo(() => Object.fromEntries((deptsData?.items ?? []).map(d => [d.department_name, d.id])), [deptsData])

  const apiParams = useMemo(() => ({
    ...params,
    departments: departments.length ? departments.map(n => nameToId[n]).filter(Boolean).join(',') : undefined,
  }), [params, departments, nameToId])

  const { data: kpiData, isLoading, isError, refetch } = useQuery({ queryKey: ['qc-kpis', apiParams], queryFn: () => getQCKpis(apiParams) })
  const { data: topics = [] }  = useQuery({ queryKey: ['qc-topics', apiParams],        queryFn: () => getCoachingTopics(apiParams) })
  const { data: topicAgents }  = useQuery({ queryKey: ['qc-topic-agents', expandedTopic, apiParams], queryFn: () => getCoachingTopicAgents({ ...apiParams, topic: expandedTopic! }), enabled: !!expandedTopic })
  const { data: repeaters = []}= useQuery({ queryKey: ['qc-repeaters', apiParams],     queryFn: () => getRepeatOffenders(apiParams) })
  const { data: quizzes = [] } = useQuery({ queryKey: ['qc-quizzes', apiParams],       queryFn: () => getQuizBreakdown(apiParams) })
  const { data: failedAgents = []} = useQuery({ queryKey: ['qc-failed-quiz', apiParams], queryFn: () => getAgentsFailedQuizzes(apiParams) })
  const { data: deptComp = [] }    = useQuery({ queryKey: ['qc-coach-dept', apiParams], queryFn: () => getCoachingDeptComparison(apiParams) })

  const cur = kpiData?.current ?? {}
  const prv = kpiData?.prior   ?? {}
  const maxTopicSessions = Math.max(...topics.map(t => t.sessions), 1)
  const navAgent = (userId: number) => navigate('/app/insights/qc-agents', { state: { preselectedUserId: userId } })

  const coachGoal = KPI_DEFS['coaching_completion_rate']?.goal ?? 92
  const quizGoal  = KPI_DEFS['quiz_pass_rate']?.goal           ?? 85

  return (
    <div>
      <div className="-mx-6 -mt-6 mb-5">
        <InsightsFilterBar
          selectedDepts={departments} onDeptsChange={setDepartments} availableDepts={deptOptions}
          period={period} onPeriodChange={setPeriod}
          customStart={customStart} customEnd={customEnd}
          onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        />
      </div>
      {isLoading && <QCPageSkeleton tiles={5} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Coaching</h1>
          <p className="text-sm text-slate-500 mt-0.5">Assessing coaching team execution and effectiveness.</p>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {['coaching_sessions_assigned','coaching_sessions_completed','coaching_completion_rate','coaching_cadence','coaching_delivery_rate'].map(code => (
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined} />
          ))}
        </div>

        {/* Most Coached Topics */}
        <InsightsSection title="Most Coached Topics" description="Click a topic to see which agents were coached.">
          <div className="space-y-1">
            {topics.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No coaching data for this period.</p>}
            {topics.map(t => {
              const barPct     = (t.sessions / maxTopicSessions) * 100
              const repeatColor = t.sessions > 0 ? '' : ''
              return (
                <ExpandableRow
                  key={t.topic}
                  isExpanded={expandedTopic === t.topic}
                  onToggle={() => setExpandedTopic(expandedTopic === t.topic ? null : t.topic)}
                  summary={
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{t.topic}</span>
                      <span className="text-xs text-slate-500 shrink-0">{t.sessions} sessions</span>
                      <span className="text-xs text-slate-400 shrink-0">{t.agents} agents</span>
                      <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                        <div className="h-full rounded-full bg-[#00aeef]/70" style={{ width: `${barPct}%` }} />
                      </div>
                    </div>
                  }
                  detail={
                    <div>
                      {!topicAgents && expandedTopic === t.topic && <p className="text-xs text-slate-400">Loading agents…</p>}
                      {topicAgents && expandedTopic === t.topic && (
                        <table className="w-full text-xs">
                          <thead><tr className="text-slate-400 border-b border-slate-200">
                            {['Agent','Dept','Sessions','Last Coached','Repeat?'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {topicAgents.map(a => (
                              <tr key={a.userId} className="border-b border-slate-100 last:border-0 hover:bg-white cursor-pointer" onClick={() => navAgent(a.userId)}>
                                <td className="py-2 pr-3 text-[#00aeef] hover:underline font-medium">{a.name}</td>
                                <td className="py-2 pr-3 text-slate-500">{a.dept}</td>
                                <td className={`py-2 pr-3 font-semibold ${a.sessions >= 3 ? 'text-red-600' : a.sessions >= 2 ? 'text-orange-500' : 'text-slate-700'}`}>{a.sessions}</td>
                                <td className="py-2 pr-3 text-slate-400">{a.lastCoached ?? '—'}</td>
                                <td className="py-2"><StatusBadge label={a.repeat ? 'Repeat' : 'First'} variant={a.repeat ? 'bad' : 'good'} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <p className="text-[11px] text-slate-400 mt-2">Click an agent name to view their full profile.</p>
                    </div>
                  }
                />
              )
              void repeatColor
            })}
          </div>
        </InsightsSection>

        {/* Repeat Coaching Agents */}
        <InsightsSection title="Repeat Coaching — Agents Needing Escalation" description="Agents coached on the same topic multiple times.">
          <div className="space-y-1">
            {repeaters.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No repeat coaching agents for this period.</p>}
            {repeaters.map(a => {
              const qaColor = (a as { qa?: number }).qa != null ? ((a as { qa?: number }).qa! >= 90 ? 'text-emerald-600' : (a as { qa?: number }).qa! >= 80 ? 'text-slate-700' : 'text-red-600') : 'text-slate-500'
              return (
                <ExpandableRow
                  key={a.userId}
                  isExpanded={expandedAgent === a.userId}
                  onToggle={() => setExpandedAgent(expandedAgent === a.userId ? null : a.userId)}
                  summary={
                    <div className="flex items-center gap-4 flex-1 text-xs min-w-0">
                      <span className="font-medium text-slate-800 w-28 truncate">{a.name}</span>
                      <span className="text-slate-500 w-24 truncate">{a.dept}</span>
                      <span className="font-semibold text-slate-700 w-12">{a.sessions} sess</span>
                      <span className="text-slate-400 w-16">{a.uniqueTopics} topics</span>
                      <span className={`font-semibold w-14 ${a.repeatTopics >= 2 ? 'text-red-600' : 'text-orange-500'}`}>{a.repeatTopics} repeat</span>
                      <StatusBadge label={a.repeatTopics >= 2 ? 'Watch' : 'Monitor'} variant={a.repeatTopics >= 2 ? 'bad' : 'warning'} />
                    </div>
                  }
                  detail={
                    <div>
                      <table className="w-full text-xs mb-2">
                        <thead><tr className="text-slate-400 border-b border-slate-200">
                          {['Topic','Sessions','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {(a.topics ?? []).map(t => (
                            <tr key={t.topic} className="border-b border-slate-100 last:border-0">
                              <td className="py-1.5 pr-3 font-medium text-slate-700">{t.topic}</td>
                              <td className={`py-1.5 pr-3 font-semibold ${t.count >= 3 ? 'text-red-600' : t.count >= 2 ? 'text-orange-500' : 'text-slate-600'}`}>{t.count}×</td>
                              <td className="py-1.5"><StatusBadge label={t.count >= 2 ? 'Repeat' : 'First'} variant={t.count >= 2 ? 'bad' : 'good'} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button onClick={() => navAgent(a.userId)} className="text-[11px] text-[#00aeef] hover:underline">View full agent profile →</button>
                    </div>
                  }
                />
              )
              void qaColor
            })}
          </div>
        </InsightsSection>

        {/* Quiz Performance */}
        <InsightsSection title="Quiz Performance" description="Quizzes assigned during coaching sessions to verify knowledge retention.">
          <div className="grid grid-cols-3 gap-3 mb-5">
            {['quiz_pass_rate','avg_quiz_score','avg_attempts_to_pass'].map(code => (
              <KpiTile key={code} kpiCode={code} small value={cur[code] ?? null} priorValue={prv[code] ?? undefined} />
            ))}
          </div>
          <div className="text-[13px] font-semibold text-slate-700 mb-2">Quiz Breakdown</div>
          <table className="w-full text-sm mb-5">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
              {['Quiz','Attempts','Pass Rate','Avg Score','Avg Tries','Fails'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>)}
            </tr></thead>
            <tbody>
              {quizzes.map(q => (
                <tr key={q.quiz} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{q.quiz}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{q.attempts}</td>
                  <td className={`py-2.5 pr-4 font-semibold ${passColor(q.passRate)}`}>{fmt(q.passRate, '%')}</td>
                  <td className={`py-2.5 pr-4 ${q.avgScore != null && q.avgScore >= 80 ? 'text-emerald-600' : q.avgScore != null && q.avgScore >= 65 ? 'text-orange-500' : 'text-red-600'}`}>{fmt(q.avgScore, '%')}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{q.attempts > 0 ? (q.attempts / Math.max(q.passed, 1)).toFixed(1) : '—'}</td>
                  <td className={`py-2.5 font-semibold ${(q.attempts - q.passed) > 10 ? 'text-red-600' : (q.attempts - q.passed) > 5 ? 'text-orange-500' : 'text-slate-600'}`}>{q.attempts - q.passed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[13px] font-semibold text-slate-700 mb-2">Agents with Most Failed Quizzes</div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
              {['Agent','Dept','Failed Quizzes','Fails','Avg Score'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>)}
            </tr></thead>
            <tbody>
              {failedAgents.map(a => (
                <tr key={a.userId} className="border-b border-slate-100 last:border-0 hover:bg-red-50 cursor-pointer" onClick={() => navAgent(a.userId)}>
                  <td className="py-2.5 pr-4 font-medium text-[#00aeef]">{a.name}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{a.dept}</td>
                  <td className="py-2.5 pr-4 text-xs text-slate-500">{a.quizzes.join(', ')}</td>
                  <td className="py-2.5 pr-4 font-bold text-red-600">{a.failed}</td>
                  <td className={`py-2.5 ${a.avgScore != null && a.avgScore >= 70 ? 'text-orange-500' : 'text-red-600'}`}>{fmt(a.avgScore, '%')}</td>
                </tr>
              ))}
              {failedAgents.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-sm text-slate-400">No failed quizzes in this period.</td></tr>}
            </tbody>
          </table>
        </InsightsSection>

        {/* Department Comparison */}
        <InsightsSection title="Department Coaching Comparison">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
              {['Dept','Assigned','Completed','Completion %','Avg Days to Close'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>)}
            </tr></thead>
            <tbody>
              {deptComp.map(row => (
                <tr key={row.dept} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => setDepartments([row.dept])}>
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{row.dept}</td>
                  <td className="py-2.5 pr-4 text-slate-500">—</td>
                  <td className="py-2.5 pr-4 text-slate-600">{row.completed}</td>
                  <td className="py-2.5 pr-4">
                    <span className="flex items-center gap-1.5">
                      <StatusDot value={row.completed > 0 ? (row.completed / row.sessions) * 100 : 0} thresholds={{ direction: 'UP_IS_GOOD', goal: coachGoal, warn: coachGoal - 12, crit: coachGoal - 27 }} />
                      {row.sessions > 0 ? `${Math.round((row.completed / row.sessions) * 100)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-2.5">{fmt(row.avgDays, ' days')}</td>
                </tr>
              ))}
              {deptComp.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-sm text-slate-400">No data available.</td></tr>}
            </tbody>
          </table>
        </InsightsSection>
      </div>}
    </div>
  )
  void quizGoal
}
