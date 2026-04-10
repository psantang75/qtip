import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsFilterBar, InsightsSection, KpiTile, StatusBadge } from '@/components/insights'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import { getQCAgentProfile, getCategoryScores, getFormScores } from '@/services/insightsQCService'
import type { AgentSummary, QCParams } from '@/services/insightsQCService'
import { scoreColor } from '@/components/insights/agentProfileHelpers'
import type { FormSummaryItem } from '@/components/insights/agentProfileHelpers'
import AgentQualitySection from '@/components/insights/AgentQualitySection'
import AgentCoachingSection from '@/components/insights/AgentCoachingSection'
import AgentWarningsSection from '@/components/insights/AgentWarningsSection'

interface Props {
  agent: AgentSummary; apiParams: QCParams; onBack: () => void
  selectedForms: string[]; onFormsChange: (v: string[]) => void
  deptOptions: string[]; departments: string[]; setDepartments: (v: string[]) => void
  period: string; setPeriod: (v: string) => void
  customStart: string; setCustomStart: (v: string) => void
  customEnd: string; setCustomEnd: (v: string) => void
}

export default function QCAgentProfile({ agent, apiParams, onBack, selectedForms, onFormsChange,
  deptOptions, departments, setDepartments, period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd }: Props) {

  const [expandedForm, setExpandedForm] = useState<string | null>(null)
  const [showAllCats,  setShowAllCats]  = useState(false)
  const { data: kpiConfig } = useKpiConfig()
  const qaThresh = resolveThresholds('avg_qa_score', kpiConfig)
  const qaGoal = qaThresh.goal ?? 90
  const qaWarn = qaThresh.warn ?? 80
  const quizThresh = resolveThresholds('avg_quiz_score', kpiConfig)
  const quizGoal = quizThresh.goal ?? 80
  const quizWarn = quizThresh.warn ?? 70

  const { data: profile }       = useQuery({ queryKey: ['qc-agent-profile', agent.userId, apiParams], queryFn: () => getQCAgentProfile(agent.userId, apiParams) })
  const { data: formScoresData = [] } = useQuery({ queryKey: ['qc-forms', apiParams], queryFn: () => getFormScores(apiParams) })

  const selectedFormId = useMemo(() => {
    if (selectedForms.length === 0) return null
    return formScoresData.find(f => f.form === selectedForms[0])?.id ?? null
  }, [selectedForms, formScoresData])

  const catParams = useMemo(() => ({ ...apiParams, ...(selectedFormId ? { form: selectedFormId } : {}) }), [apiParams, selectedFormId])
  const { data: catScores = [] } = useQuery({ queryKey: ['qc-cats', catParams], queryFn: () => getCategoryScores(catParams), enabled: !!profile })

  const qaTrend = useMemo(() => {
    if (!profile) return []
    const monthly = new Map<string, number[]>()
    for (const a of profile.recentAudits) {
      if (a.score == null) continue
      const key = a.date.slice(0, 7)
      if (!monthly.has(key)) monthly.set(key, [])
      monthly.get(key)!.push(a.score)
    }
    return [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, scores]) => ({
        label: new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        value: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10,
      }))
  }, [profile])

  const formSummary: FormSummaryItem[] = useMemo(() => {
    if (!profile) return []
    const map = new Map<string, { form: string; scores: number[]; reviews: typeof profile.recentAudits }>()
    for (const a of profile.recentAudits) {
      if (!map.has(a.form)) map.set(a.form, { form: a.form, scores: [], reviews: [] })
      const e = map.get(a.form)!
      if (a.score != null) e.scores.push(a.score)
      e.reviews.push(a)
    }
    return [...map.values()].map(f => ({ form: f.form, avg: f.scores.length ? f.scores.reduce((a, b) => a + b, 0) / f.scores.length : null, count: f.reviews.length, reviews: f.reviews }))
  }, [profile])

  const topicCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of profile?.coachingSessions ?? []) for (const t of s.topics) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }, [profile?.coachingSessions])

  const ds = profile?.disputeStats
  const wus = profile?.writeUps ?? []
  const availableForms = formSummary.map(f => f.form)

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments} availableDepts={deptOptions}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        showFormFilter selectedForms={selectedForms} onFormsChange={onFormsChange}
        availableForms={availableForms}
        showBackButton onBack={onBack}
      />

      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-0.5">
            <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
            {agent.risk && <StatusBadge label="At Risk" variant="bad" />}
          </div>
          <p className="text-sm text-slate-500">{agent.dept} · {period}</p>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiTile kpiCode="avg_qa_score" value={agent.qa} thresholds={resolveThresholds('avg_qa_score', kpiConfig)} />
          <KpiTile kpiCode="audits_completed" value={profile?.recentAudits.length ?? null} thresholds={resolveThresholds('audits_completed', kpiConfig)} />
          <KpiTile kpiCode="coaching_sessions_completed" value={profile?.coachingSessions.length ?? null} thresholds={resolveThresholds('coaching_sessions_completed', kpiConfig)} />
          <KpiTile kpiCode="quiz_pass_rate" value={profile?.quizzes.length ? Math.round(profile.quizzes.filter(q => q.passed).length / profile.quizzes.length * 100) : null} thresholds={resolveThresholds('quiz_pass_rate', kpiConfig)} />
          <KpiTile kpiCode="dispute_rate" value={ds?.total != null && profile?.recentAudits.length ? Math.round(ds.total / profile.recentAudits.length * 1000) / 10 : null} thresholds={resolveThresholds('dispute_rate', kpiConfig)} />
          <KpiTile kpiCode="total_writeups_issued" value={wus.length ?? null} thresholds={resolveThresholds('total_writeups_issued', kpiConfig)} />
        </div>

        <AgentQualitySection
          qaTrend={qaTrend} qaGoal={qaGoal} qaWarn={qaWarn} ds={ds}
          formSummary={formSummary} expandedForm={expandedForm} setExpandedForm={setExpandedForm}
          catScores={catScores} showAllCats={showAllCats} setShowAllCats={setShowAllCats}
        />

        <AgentCoachingSection
          coachingSessions={profile?.coachingSessions ?? []}
          topicCounts={topicCounts}
        />

        <InsightsSection title="Quiz Performance">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <KpiTile kpiCode="quiz_pass_rate" small value={profile?.quizzes.length ? Math.round(profile.quizzes.filter(q => q.passed).length / profile.quizzes.length * 100) : null} thresholds={resolveThresholds('quiz_pass_rate', kpiConfig)} />
            <KpiTile kpiCode="avg_quiz_score" small value={profile?.quizzes.length ? Math.round(profile.quizzes.reduce((s, q) => s + q.score, 0) / profile.quizzes.length * 10) / 10 : null} thresholds={resolveThresholds('avg_quiz_score', kpiConfig)} />
            <KpiTile kpiCode="avg_attempts_to_pass" small value={profile?.quizzes.length ? Math.round(profile.quizzes.reduce((s, q) => s + q.attempts, 0) / profile.quizzes.length * 10) / 10 : null} thresholds={resolveThresholds('avg_attempts_to_pass', kpiConfig)} />
          </div>
          {(!profile?.quizzes.length)
            ? <p className="text-sm text-slate-400 py-3 text-center">No quiz attempts this period.</p>
            : (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  {['Quiz','Date','Score','Attempts','Result'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-4">{h}</th>)}
                </tr></thead>
                <tbody>
                  {profile.quizzes.map(q => (
                    <tr key={q.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-slate-800">{q.quiz}</td>
                      <td className="py-2 pr-4 text-slate-500">{q.date}</td>
                      <td className={`py-2 pr-4 font-semibold ${scoreColor(q.score, quizGoal, quizWarn)}`}>{q.score.toFixed(1)}%</td>
                      <td className={`py-2 pr-4 font-semibold ${q.attempts > 1 ? 'text-orange-500' : 'text-slate-600'}`}>{q.attempts}</td>
                      <td className="py-2"><StatusBadge label={q.passed ? 'Passed' : 'Failed'} variant={q.passed ? 'good' : 'bad'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>

        <AgentWarningsSection wus={wus} />
      </div>
    </div>
  )
}
