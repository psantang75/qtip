import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { InsightsFilterBar, InsightsSection, KpiTile, StatRow, StatusBadge, TrendChart, ExpandableRow } from '@/components/insights'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'
import { getQCTrends, getQCAgentProfile, getCategoryScores, getFormScores } from '@/services/insightsQCService'
import type { AgentSummary, QCParams } from '@/services/insightsQCService'

const TL = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' } as Record<string,string>
const TC = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' } as Record<string,string>
const SL = { DRAFT:'Draft', SCHEDULED:'Scheduled', DELIVERED:'Delivered', AWAITING_SIGNATURE:'Awaiting Sig.', SIGNED:'Signed', FOLLOW_UP_PENDING:'Follow-Up', CLOSED:'Closed' } as Record<string,string>
const fmtN = (v: number | null | undefined, s = '') => v == null ? '—' : `${v.toFixed(1)}${s}`
function scoreColor(v: number | null, goal = 85, warn = 75): string {
  if (!v) return 'text-slate-400'
  if (v >= goal) return 'text-emerald-600'
  if (v >= warn) return 'text-orange-500'
  return 'text-red-600'
}

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
  const { data: trendData }     = useQuery({ queryKey: ['qc-trends-qa', apiParams], queryFn: () => getQCTrends({ ...apiParams, kpis: 'avg_qa_score' }) })
  const { data: formScoresData = [] } = useQuery({ queryKey: ['qc-forms', apiParams], queryFn: () => getFormScores(apiParams) })

  const selectedFormId = useMemo(() => {
    if (selectedForms.length === 0) return null
    return formScoresData.find(f => f.form === selectedForms[0])?.id ?? null
  }, [selectedForms, formScoresData])

  const catParams = useMemo(() => ({ ...apiParams, ...(selectedFormId ? { form: selectedFormId } : {}) }), [apiParams, selectedFormId])
  const { data: catScores = [] } = useQuery({ queryKey: ['qc-cats', catParams], queryFn: () => getCategoryScores(catParams), enabled: !!profile })

  const qaTrend = trendData?.map(r => ({ label: String(r.label ?? ''), value: r['avg_qa_score'] != null ? Number(r['avg_qa_score']) : null })) ?? []

  // Derive form summaries from recentAudits
  const formSummary = useMemo(() => {
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

  // Topic counts across all sessions
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
          <KpiTile kpiCode="dispute_rate" value={ds?.total ?? null} thresholds={resolveThresholds('dispute_rate', kpiConfig)} />
          <KpiTile kpiCode="total_writeups_issued" value={wus.length ?? null} thresholds={resolveThresholds('total_writeups_issued', kpiConfig)} />
        </div>

        {/* ── Quality ── */}
        <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-[#00aeef]">Quality</div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InsightsSection title="QA Score Trend">
            <TrendChart data={qaTrend} color="#00aeef" goalValue={qaGoal} height={110} metricLabel="%" />
          </InsightsSection>
          <InsightsSection title="Dispute Activity">
            <StatRow label="Total Disputes Filed"           value={String(ds?.total ?? 0)} valueColor={(ds?.total ?? 0) > 0 ? 'text-orange-500' : 'text-emerald-600'} />
            <StatRow label="Upheld (Original Score Kept)"   value={String(ds?.upheld ?? 0)} />
            <StatRow label="Adjusted (Score Changed)"       value={String(ds?.adjusted ?? 0)} />
            <StatRow label="Open"                           value={String(ds?.open ?? 0)} valueColor={(ds?.open ?? 0) > 0 ? 'text-orange-500' : undefined} />
            <StatRow label="Avg Resolution Time"            value={fmtN(ds?.avgResolutionDays, ' days')} />
          </InsightsSection>
        </div>

        <InsightsSection title="Forms Performance">
          {formSummary.length === 0 && <p className="text-sm text-slate-400 py-3">No evaluations in this period.</p>}
          {formSummary.map(f => (
            <ExpandableRow
              key={f.form} isExpanded={expandedForm === f.form}
              onToggle={() => setExpandedForm(expandedForm === f.form ? null : f.form)}
              summary={
                <div className="flex items-center flex-1 min-w-0">
                  <span className="font-medium text-slate-800 flex-1 truncate">{f.form}</span>
                  <span className="text-xs text-slate-700 shrink-0">{f.count} Reviews</span>
                  <span className={`text-sm font-bold shrink-0 ml-4 ${scoreColor(f.avg, qaGoal, qaWarn)}`}>{fmtN(f.avg, '%')} Average</span>
                </div>
              }
              detail={
                <div className="pt-1">
                  <div className="flex items-center text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5">
                    <span className="w-20 shrink-0">Review ID</span><span className="w-28 shrink-0">Review Date</span><span className="w-28 shrink-0">Interaction Date</span><span className="w-16 shrink-0 text-right">Score</span>
                  </div>
                  {f.reviews.map(r => (
                    <div key={r.id} className="flex items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
                      <span className="w-20 shrink-0 text-slate-400">#{r.id}</span>
                      <span className="w-28 shrink-0 text-slate-700">{r.date}</span>
                      <span className="w-28 shrink-0 text-slate-400">{r.callDate ?? '—'}</span>
                      <span className={`w-16 shrink-0 text-right font-semibold ${scoreColor(r.score, qaGoal, qaWarn)}`}>{r.score != null ? `${r.score.toFixed(1)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              }
            />
          ))}
        </InsightsSection>

        <InsightsSection title="Category Performance">
          {catScores.length === 0 ? <p className="text-sm text-slate-400 py-2">No category data.</p> : (() => {
            const sorted = [...catScores].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0))
            const visible = showAllCats ? sorted : sorted.slice(0, 5)
            return (
              <>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                    {['Category','Form','Audits','Avg Score','vs Goal','Status'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4 last:pr-0">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {visible.map((c, i) => {
                      const delta = c.avgScore != null ? c.avgScore - qaGoal : null
                      return (
                        <tr key={`${c.form}-${c.category}-${i}`} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-4 font-medium text-slate-800">{c.category}</td>
                          <td className="py-2 pr-4 text-slate-500 text-xs">{c.form}</td>
                          <td className="py-2 pr-4 text-slate-500">{c.audits}</td>
                          <td className={`py-2 pr-4 font-semibold ${scoreColor(c.avgScore, qaGoal, qaWarn)}`}>{fmtN(c.avgScore, '%')}</td>
                          <td className={`py-2 pr-4 font-medium ${delta != null && delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{delta != null ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—'}</td>
                          <td className="py-2"><StatusBadge label={!delta || delta >= 0 ? 'On Track' : c.avgScore != null && c.avgScore >= qaWarn ? 'Near Goal' : 'Below Goal'} variant={!delta || delta >= 0 ? 'good' : c.avgScore != null && c.avgScore >= qaWarn ? 'warning' : 'bad'} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {sorted.length > 5 && (
                  <button onClick={() => setShowAllCats(!showAllCats)} className="mt-3 text-xs text-[#00aeef] hover:underline">
                    {showAllCats ? 'Show bottom 5 only' : `Show all ${sorted.length} categories`}
                  </button>
                )}
              </>
            )
          })()}
        </InsightsSection>

        {/* ── Coaching ── */}
        <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-[#00aeef]">Coaching</div>

        <InsightsSection title="Coaching Sessions">
          <TooltipProvider delayDuration={200}>
          {(!profile?.coachingSessions.length)
            ? <p className="text-sm text-slate-400 py-3 text-center">No coaching sessions this period.</p>
            : (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  {['Date','Purpose','Format','Topics','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-4">{h}</th>)}
                </tr></thead>
                <tbody>
                  {profile.coachingSessions.map(s => {
                    const fmtDate = new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    const purposeLabel = s.purpose === 'WEEKLY' ? 'Weekly' : s.purpose === 'PERFORMANCE' ? 'Performance' : s.purpose === 'ONBOARDING' ? 'Onboarding' : s.purpose
                    const formatLabel = s.format === 'ONE_ON_ONE' ? '1-on-1' : s.format === 'SIDE_BY_SIDE' ? 'Side-by-Side' : s.format === 'TEAM_SESSION' ? 'Team' : s.format || '—'
                    return (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 font-medium text-slate-700">{fmtDate}</td>
                        <td className="py-2 pr-4 text-slate-600">{purposeLabel}</td>
                        <td className="py-2 pr-4 text-slate-600">{formatLabel}</td>
                        <td className="py-2 pr-4">
                          {s.topics.length > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-slate-700 cursor-default truncate block max-w-[200px]">{s.topics.join(', ')}</span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" sideOffset={6} className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                                <ul className="space-y-1">
                                  {s.topics.map((t, i) => (
                                    <li key={`${t}-${i}`} className="flex items-center gap-2 text-[13px] text-slate-700">
                                      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                    </li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2"><StatusBadge label={s.status === 'COMPLETED' || s.status === 'CLOSED' ? 'Completed' : s.status === 'SCHEDULED' ? 'Scheduled' : 'In Progress'} variant={s.status === 'COMPLETED' || s.status === 'CLOSED' ? 'good' : 'warning'} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          }
          </TooltipProvider>
        </InsightsSection>

        <InsightsSection title="Topic Frequency">
          {topicCounts.size === 0
            ? <p className="text-sm text-slate-400 py-3 text-center">No coaching topics this period.</p>
            : (
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  {['Topic','Sessions','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-4">{h}</th>)}
                </tr></thead>
                <tbody>
                  {[...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => (
                    <tr key={topic} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-slate-700">{topic}</td>
                      <td className={`py-2 pr-4 font-bold ${count >= 3 ? 'text-red-600' : count >= 2 ? 'text-orange-500' : 'text-slate-600'}`}>{count}×</td>
                      <td className="py-2"><StatusBadge label={count >= 2 ? 'Repeat' : 'First'} variant={count >= 2 ? 'bad' : 'good'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>

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

        {/* ── Warnings ── */}
        <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-red-500">Performance Warnings</div>

        <InsightsSection title="Warning History">
          {wus.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ShieldCheck size={32} className="text-[#00aeef] mb-3" />
              <p className="text-sm font-medium text-slate-600">No performance warnings for the selected period</p>
            </div>
          ) : (
            <>
              <TooltipProvider delayDuration={200}>
              <table className="w-full text-xs mb-4">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  {['Type','Status','Created','Meeting','Follow-Up','Manager','Prior','Coaching','Policies'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
                </tr></thead>
                <tbody>
                  {wus.map(w => (
                    <tr key={w.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${TC[w.type] ?? 'text-slate-600 bg-slate-100 border-slate-200'}`}>{TL[w.type] ?? w.type}</span></td>
                      <td className="py-2 pr-3 text-slate-600">{SL[w.status] ?? w.status}</td>
                      <td className="py-2 pr-3 text-slate-500">{w.date}</td>
                      <td className="py-2 pr-3 text-slate-500">{w.meetingDate ?? '—'}</td>
                      <td className={`py-2 pr-3 ${w.followUpDate ? 'text-orange-500 font-medium' : 'text-slate-400'}`}>{w.followUpDate ?? '—'}</td>
                      <td className="py-2 pr-3 text-slate-500">{w.managerName ?? '—'}</td>
                      <td className={`py-2 pr-3 font-bold ${w.priorCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{w.priorCount}</td>
                      <td className="py-2 pr-3"><span className={`font-bold text-sm ${w.linkedCoaching ? 'text-emerald-600' : 'text-red-500'}`}>{w.linkedCoaching ? '✓' : '✗'}</span></td>
                      <td className="py-2 max-w-[140px]">
                        {w.policies.length > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-slate-500 truncate block cursor-default">{w.policies.join(', ')}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" sideOffset={6} className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                              <ul className="space-y-1">
                                {w.policies.map((p, i) => (
                                  <li key={`${p}-${i}`} className="flex items-center gap-2 text-[13px] text-slate-700">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{p}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TooltipProvider>
              <StatRow label="Total Warnings (Period)"  value={String(wus.length)} valueColor="text-orange-500" />
              <StatRow label="Pending Follow-Ups"       value={String(wus.filter(w => w.status === 'FOLLOW_UP_PENDING').length)} />
            </>
          )}
        </InsightsSection>
      </div>
    </div>
  )
}
