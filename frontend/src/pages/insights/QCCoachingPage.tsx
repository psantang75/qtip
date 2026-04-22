import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  InsightsFilterBar, InsightsSection, KpiTile, TrendChart,
  StatusDot, ExpandableRow, QCPageSkeleton, ErrorCard,
} from '@/components/insights'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CoachingTopicsSection from '@/components/insights/CoachingTopicsSection'
import CoachingRepeatOffendersSection from '@/components/insights/CoachingRepeatOffendersSection'
import CoachingQuizSection from '@/components/insights/CoachingQuizSection'
import { useQCFilters } from '@/hooks/useQCFilters'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import {
  getQCKpis, getQCTrends, getFilterOptions, getCoachingTopics, getCoachingTopicAgents,
  getRepeatOffenders, getSessionsByStatus, getQuizBreakdown, getCoachingDeptComparison,
} from '@/services/insightsQCService'

const STATUS_ORDER = [
  'SCHEDULED', 'IN_PROCESS', 'AWAITING_CSR_ACTION', 'QUIZ_PENDING',
  'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED',
] as const

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled', IN_PROCESS: 'In Process', AWAITING_CSR_ACTION: 'Awaiting CSR Action',
  QUIZ_PENDING: 'Quiz Pending', COMPLETED: 'Completed', FOLLOW_UP_REQUIRED: 'Follow-Up Required',
  CLOSED: 'Closed',
}

const PURPOSE_MAP: Record<string, string> = { WEEKLY: 'Weekly', PERFORMANCE: 'Performance', ONBOARDING: 'Onboarding' }
const FORMAT_MAP: Record<string, string>  = { ONE_ON_ONE: '1-on-1', SIDE_BY_SIDE: 'Side-by-Side', TEAM_SESSION: 'Team' }
const TIP_CLASSES = 'max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg'

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

export default function QCCoachingPage() {
  const navigate = useNavigate()
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          resetFilters, params } = useQCFilters()
  const [expandedTopic,  setExpandedTopic]  = useState<string | null>(null)
  const [expandedAgent,  setExpandedAgent]  = useState<number | null>(null)
  const [expandedStatus, setExpandedStatus] = useState<string | null>(null)
  const [showAllTopics,  setShowAllTopics]  = useState(false)
  const [expandedQuiz,   setExpandedQuiz]   = useState<string | null>(null)
  const [showAllQuizzes, setShowAllQuizzes] = useState(false)

  const apiParams = useMemo(() => ({ ...params }), [params])

  const { data: kpiConfig } = useKpiConfig()
  const { data: filterOpts } = useQuery({ queryKey: ['qc-filter-opts', apiParams], queryFn: () => getFilterOptions(apiParams) })
  const deptOptions = filterOpts?.departments ?? []

  const { data: kpiData, isLoading, isError, refetch } = useQuery({ queryKey: ['qc-kpis', apiParams], queryFn: () => getQCKpis(apiParams) })
  const { data: scheduledTrend } = useQuery({ queryKey: ['qc-trends-sched', apiParams], queryFn: () => getQCTrends({ ...apiParams, kpis: 'coaching_sessions_scheduled' }) })
  const { data: completedTrend } = useQuery({ queryKey: ['qc-trends-comp', apiParams], queryFn: () => getQCTrends({ ...apiParams, kpis: 'coaching_sessions_completed' }) })
  const { data: statusGroups = [] } = useQuery({ queryKey: ['qc-status-groups', apiParams], queryFn: () => getSessionsByStatus(apiParams) })
  const { data: topics = [] }  = useQuery({ queryKey: ['qc-topics', apiParams],        queryFn: () => getCoachingTopics(apiParams) })
  const { data: topicAgents }  = useQuery({ queryKey: ['qc-topic-agents', expandedTopic, apiParams], queryFn: () => getCoachingTopicAgents({ ...apiParams, topic: expandedTopic! }), enabled: !!expandedTopic })
  const { data: repeaters = []}= useQuery({ queryKey: ['qc-repeaters', apiParams],     queryFn: () => getRepeatOffenders(apiParams) })
  const { data: quizzes = [] } = useQuery({ queryKey: ['qc-quizzes', apiParams],       queryFn: () => getQuizBreakdown(apiParams) })
  const { data: deptComp = [] }    = useQuery({ queryKey: ['qc-coach-dept', apiParams], queryFn: () => getCoachingDeptComparison(apiParams) })

  const cur       = kpiData?.current   ?? {}
  const prv       = kpiData?.prior     ?? {}
  const meta      = kpiData?.meta
  const priorMeta = kpiData?.priorMeta
  const navAgent = (userId: number) => navigate(`/app/insights/qc-agents?agent=${userId}`)

  const coachThresh = resolveThresholds('coaching_completion_rate', kpiConfig)
  const schedGoal = resolveThresholds('coaching_sessions_scheduled', kpiConfig).goal ?? undefined
  const compGoal  = resolveThresholds('coaching_sessions_completed', kpiConfig).goal ?? undefined
  const schedTrends = scheduledTrend?.map(r => ({ label: String(r.label ?? ''), value: r['coaching_sessions_scheduled'] != null ? Number(r['coaching_sessions_scheduled']) : null })) ?? []
  const compTrends  = completedTrend?.map(r => ({ label: String(r.label ?? ''), value: r['coaching_sessions_completed'] != null ? Number(r['coaching_sessions_completed']) : null })) ?? []
  const statusMap = new Map(statusGroups.map(g => [g.status, g]))
  const maxStatusCount = Math.max(...statusGroups.map(g => g.count), 1)

  const visibleTopics  = showAllTopics  ? topics      : topics.slice(0, 5)
  const maxTopicSess   = Math.max(...visibleTopics.map(t => t.sessions), 1)
  const sortedQuizzes  = [...quizzes].sort((a, b) => (b.attempts - b.passed) - (a.attempts - a.passed))
  const visibleQuizzes = showAllQuizzes ? sortedQuizzes : sortedQuizzes.slice(0, 5)
  const maxQuizAttempts = Math.max(...visibleQuizzes.map(q => q.attempts), 1)
  const deptWithData   = deptComp.filter(r => r.sessions > 0)

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments}
        availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        businessDays={meta?.businessDays} priorBusinessDays={priorMeta?.businessDays}
        priorDateRange={priorMeta?.startDate ? { start: priorMeta.startDate, end: priorMeta.endDate } : undefined}
        onReset={resetFilters}
      />
      {isLoading && <QCPageSkeleton tiles={4} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Coaching</h1>
          <p className="text-sm text-slate-500 mt-0.5">Assessing coaching team execution and effectiveness.</p>
        </div>

        {/* 1. KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {['coaching_sessions_assigned','coaching_sessions_scheduled','coaching_sessions_completed','coaching_sessions_closed'].map(code => (
            <KpiTile key={code} kpiCode={code} value={cur[code] ?? null} priorValue={prv[code] ?? undefined}
              thresholds={resolveThresholds(code, kpiConfig)} />
          ))}
        </div>

        {/* 2. Trend charts — Scheduled + Completed side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="Sessions Scheduled" infoKpiCodes={['coaching_sessions_scheduled']}>
            <TrendChart data={schedTrends} color="#00aeef" goalValue={schedGoal} height={120} />
          </InsightsSection>
          <InsightsSection title="Sessions Completed" infoKpiCodes={['coaching_sessions_completed']}>
            <TrendChart data={compTrends} color="#00aeef" goalValue={compGoal} height={120} />
          </InsightsSection>
        </div>

        {/* 3. Coaching Sessions by Status */}
        <InsightsSection title="Coaching Sessions by Status" infoKpiCodes={['coaching_status_distribution']}>
          <TooltipProvider delayDuration={200}>
            {statusGroups.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No session data for this period.</p>}
            {STATUS_ORDER.filter(s => statusMap.has(s)).map(status => {
              const g = statusMap.get(status)!
              const label = STATUS_LABELS[status] ?? status
              const barPct = maxStatusCount > 0 ? Math.round((g.count / maxStatusCount) * 100) : 0
              return (
                <ExpandableRow
                  key={status}
                  isExpanded={expandedStatus === status}
                  onToggle={() => setExpandedStatus(expandedStatus === status ? null : status)}
                  summary={
                    <div className="flex items-center flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-slate-800 w-40 shrink-0">{label}</span>
                      <span className="flex-1" />
                      <span className="text-xs text-slate-700 w-20 text-right shrink-0">{g.count} Sessions</span>
                      <div className="w-28 bg-slate-100 rounded-full h-2 overflow-hidden shrink-0 ml-4">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${barPct}%` }} />
                      </div>
                      <span className="text-xs text-slate-700 w-16 text-right shrink-0 ml-4">{g.agents.length} Agents</span>
                    </div>
                  }
                  detail={
                    <div className="pt-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_3.5rem] text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5 gap-x-5">
                        <span>Agent</span><span>Department</span><span>Purpose</span><span>Format</span><span>Topics</span><span className="text-right">Sessions</span>
                      </div>
                      {g.agents.map(a => {
                        const aTopics = a.topics ?? []
                        return (
                          <div key={`${a.userId}-${a.purpose}-${a.format}`}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_3.5rem] items-center text-xs py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer gap-x-5"
                            onClick={() => navAgent(a.userId)}
                          >
                            <span className="text-primary hover:underline font-medium truncate">{a.name}</span>
                            <span className="text-slate-500 truncate">{a.dept}</span>
                            <span className="text-slate-600">{PURPOSE_MAP[a.purpose] ?? a.purpose}</span>
                            <span className="text-slate-600">{FORMAT_MAP[a.format] ?? a.format}</span>
                            <span className="text-slate-500 truncate">
                              {aTopics.length > 0 ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-default truncate block">{aTopics.join(', ')}</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" sideOffset={6} className={TIP_CLASSES}>
                                    <ul className="space-y-1">
                                      {aTopics.map((t, i) => (
                                        <li key={`${t}-${i}`} className="flex items-center gap-2 text-[13px] text-slate-700">
                                          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                        </li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              ) : <span className="text-slate-300">&mdash;</span>}
                            </span>
                            <span className="font-semibold text-slate-700 text-right">{a.sessions}</span>
                          </div>
                        )
                      })}
                    </div>
                  }
                />
              )
            })}
          </TooltipProvider>
        </InsightsSection>

        {/* 4. Repeat Coaching */}
        <CoachingRepeatOffendersSection
          repeaters={repeaters}
          expandedAgent={expandedAgent}
          onToggleAgent={(userId) => setExpandedAgent(expandedAgent === userId ? null : userId)}
          onNavAgent={navAgent}
        />

        {/* 5. Most Coached Topics */}
        <CoachingTopicsSection
          topics={topics}
          visibleTopics={visibleTopics}
          maxTopicSess={maxTopicSess}
          expandedTopic={expandedTopic}
          onToggleTopic={(topic) => setExpandedTopic(expandedTopic === topic ? null : topic)}
          topicAgents={topicAgents}
          showAllTopics={showAllTopics}
          onToggleShowAll={() => setShowAllTopics(!showAllTopics)}
          onNavAgent={navAgent}
        />

        {/* 6. Quiz Performance */}
        <CoachingQuizSection
          cur={cur}
          prv={prv}
          kpiConfig={kpiConfig}
          sortedQuizzes={sortedQuizzes}
          visibleQuizzes={visibleQuizzes}
          maxQuizAttempts={maxQuizAttempts}
          expandedQuiz={expandedQuiz}
          onToggleQuiz={(quiz) => setExpandedQuiz(expandedQuiz === quiz ? null : quiz)}
          showAllQuizzes={showAllQuizzes}
          onToggleShowAll={() => setShowAllQuizzes(!showAllQuizzes)}
          onNavAgent={navAgent}
        />

        {/* 7. Department Comparison */}
        {deptWithData.length > 0 && (
          <InsightsSection title="Department Coaching Comparison" infoKpiCodes={['coaching_dept_comparison']}>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                {['Department','Sessions','Completed','Completion %','Avg Days to Close'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>)}
              </tr></thead>
              <tbody>
                {deptWithData.map(row => (
                  <tr key={row.dept} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => setDepartments([row.dept])}>
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{row.dept}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{row.sessions}</td>
                    <td className="py-2.5 pr-4 text-slate-600">{row.completed}</td>
                    <td className="py-2.5 pr-4">
                      <span className="flex items-center gap-1.5">
                        <StatusDot value={row.completed > 0 ? (row.completed / row.sessions) * 100 : 0} thresholds={coachThresh} />
                        {row.sessions > 0 ? `${Math.round((row.completed / row.sessions) * 100)}%` : '—'}
                      </span>
                    </td>
                    <td className="py-2.5">{fmt(row.avgDays, ' days')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </InsightsSection>
        )}
      </div>}
    </div>
  )
}
