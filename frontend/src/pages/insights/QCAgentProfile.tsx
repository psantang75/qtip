import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InsightsFilterBar, InsightsSection, KpiTile, StatusBadge } from '@/components/insights'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import { getQCAgentFull } from '@/services/insightsQCService'
import type { AgentSummary, QCParams } from '@/services/insightsQCService'
import { scoreColor } from '@/components/insights/agentProfileHelpers'
import AgentQualitySection from '@/components/insights/AgentQualitySection'
import AgentCoachingSection from '@/components/insights/AgentCoachingSection'
import AgentWarningsSection from '@/components/insights/AgentWarningsSection'

interface Props {
  agent: AgentSummary; apiParams: QCParams; onBack: () => void
  selectedForms: string[]; onFormsChange: (v: string[]) => void
  period: string; setPeriod: (v: string) => void
  customStart: string; setCustomStart: (v: string) => void
  customEnd: string; setCustomEnd: (v: string) => void
  showBackButton?: boolean
}

export default function QCAgentProfile({ agent, apiParams, onBack, selectedForms, onFormsChange,
  period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd, showBackButton = true }: Props) {

  const [showAllCats, setShowAllCats]  = useState(false)
  const { data: kpiConfig } = useKpiConfig()
  const qaThresh = resolveThresholds('avg_qa_score', kpiConfig)
  const qaGoal = qaThresh.goal ?? 90
  const qaWarn = qaThresh.warn ?? 80
  const quizThresh = resolveThresholds('avg_quiz_score', kpiConfig)
  const quizGoal = quizThresh.goal ?? 80
  const quizWarn = quizThresh.warn ?? 70

  // Single bundled fetch — collapses the 5 endpoints (profile, KPIs, trends,
  // form scores, category scores) that this page used to call individually
  // into one HTTP round trip. The per-section endpoints stay alive in the
  // codebase because the Quality / Coaching / Warnings pages still use them
  // directly. See backend/src/controllers/insightsQC.controller.ts → getQCAgentFull.
  const bundleParams = useMemo(() => ({ ...apiParams, kpis: 'avg_qa_score' }), [apiParams])
  const { data: bundle } = useQuery({
    queryKey: ['qc-agent-full', agent.userId, bundleParams],
    queryFn: () => getQCAgentFull(agent.userId, bundleParams),
  })

  const cur             = bundle?.kpis.current ?? {}
  const prv             = bundle?.kpis.prior   ?? {}
  const profile         = bundle?.profile
  const trendData       = bundle?.trends
  const formScoresData  = bundle?.formScores ?? []
  const catScores       = bundle?.categoryScores ?? []

  // Note: the form-id-driven category drill-down (changing the Form filter
  // narrows the Category Performance table) is intentionally not wired into
  // the bundle endpoint — selecting a form changes selectedForms which
  // re-keys the bundle (apiParams.forms), so the backend re-runs both form
  // and category queries with the new form filter in a single request.
  const qaTrend = trendData?.map(r => ({ label: String(r.label ?? ''), value: r['avg_qa_score'] != null ? Number(r['avg_qa_score']) : null })) ?? []

  const topicCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of profile?.coachingSessions ?? []) for (const t of s.topics) m.set(t, (m.get(t) ?? 0) + 1)
    return m
  }, [profile?.coachingSessions])

  const wus = profile?.writeUps ?? []
  const availableForms = formScoresData.map(f => f.form)

  return (
    <div>
      <InsightsFilterBar
        hideDeptFilter
        selectedDepts={[]} onDeptsChange={() => {}}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        showFormFilter selectedForms={selectedForms} onFormsChange={onFormsChange}
        availableForms={availableForms}
        showBackButton={showBackButton} onBack={onBack}
      />

      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-0.5">
            <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
          </div>
          <p className="text-sm text-slate-500">{agent.dept} · {period}</p>
        </div>

        {/* KPI Tiles — all bound to the unified KPI service for this agent */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {['avg_qa_score','audits_completed','critical_fail_rate','dispute_rate','coaching_sessions_completed','total_writeups_issued'].map(code => (
            <KpiTile
              key={code}
              kpiCode={code}
              value={cur[code] ?? null}
              priorValue={prv[code] ?? undefined}
              thresholds={resolveThresholds(code, kpiConfig)}
            />
          ))}
        </div>

        <AgentQualitySection
          qaTrend={qaTrend} qaGoal={qaGoal} qaWarn={qaWarn}
          cur={cur} prv={prv} kpiConfig={kpiConfig}
          formScores={formScoresData}
          catScores={catScores} showAllCats={showAllCats} setShowAllCats={setShowAllCats}
          recentAudits={profile?.recentAudits ?? []}
        />

        <AgentCoachingSection
          coachingSessions={profile?.coachingSessions ?? []}
          topicCounts={topicCounts}
        />

        <InsightsSection title="Quiz Performance">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {['quiz_pass_rate','avg_quiz_score','avg_attempts_to_pass'].map(code => (
              <KpiTile
                key={code}
                small
                kpiCode={code}
                value={cur[code] ?? null}
                priorValue={prv[code] ?? undefined}
                thresholds={resolveThresholds(code, kpiConfig)}
              />
            ))}
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
