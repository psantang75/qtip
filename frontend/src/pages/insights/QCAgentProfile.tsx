import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'
import { InsightsFilterBar, InsightsSection, StatRow, StatusBadge, TrendChart, ExpandableRow } from '@/components/insights'
import { getQCAgentProfile, getCategoryScores, getFormScores } from '@/services/insightsQCService'
import type { AgentSummary, QCParams } from '@/services/insightsQCService'

const TL = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' } as Record<string,string>
const TC = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' } as Record<string,string>
const SL = { DRAFT:'Draft', SCHEDULED:'Scheduled', DELIVERED:'Delivered', AWAITING_SIGNATURE:'Awaiting Sig.', SIGNED:'Signed', FOLLOW_UP_PENDING:'Follow-Up', CLOSED:'Closed' } as Record<string,string>
const fmtN = (v: number | null | undefined, s = '') => v == null ? '—' : `${v.toFixed(1)}${s}`
const scoreColor = (v: number | null) => !v ? 'text-slate-400' : v >= 85 ? 'text-emerald-600' : v >= 75 ? 'text-orange-500' : 'text-red-600'

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
  const [expandedQuiz, setExpandedQuiz] = useState<string | null>(null)

  const { data: profile }       = useQuery({ queryKey: ['qc-agent-profile', agent.userId, apiParams], queryFn: () => getQCAgentProfile(agent.userId, apiParams) })
  const { data: formScoresData = [] } = useQuery({ queryKey: ['qc-forms', apiParams], queryFn: () => getFormScores(apiParams) })

  const selectedFormId = useMemo(() => {
    if (selectedForms.length === 0) return null
    return formScoresData.find(f => f.form === selectedForms[0])?.id ?? null
  }, [selectedForms, formScoresData])

  const catParams = useMemo(() => ({ ...apiParams, ...(selectedFormId ? { form: selectedFormId } : {}) }), [apiParams, selectedFormId])
  const { data: catScores = [] } = useQuery({ queryKey: ['qc-cats', catParams], queryFn: () => getCategoryScores(catParams), enabled: !!profile })

  // Derive 6-month QA trend from recentAudits
  const qaTrend = useMemo(() => {
    if (!profile?.recentAudits.length) return []
    const months = new Map<string, number[]>()
    for (const a of profile.recentAudits) {
      if (!a.score || !a.date) continue
      const key   = a.date.slice(0, 7)
      const label = new Date(a.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      const entry = months.get(key) ?? []
      entry.push(a.score)
      months.set(key, entry)
    }
    return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([, scores]) => ({ label: scores[0] ? new Date(scores[0] + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : '', value: scores.reduce((a, b) => a + b, 0) / scores.length }))
  }, [profile?.recentAudits])

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
      <div className="-mx-6 -mt-6 mb-5">
        <InsightsFilterBar
          selectedDepts={departments} onDeptsChange={setDepartments} availableDepts={deptOptions}
          period={period} onPeriodChange={setPeriod}
          customStart={customStart} customEnd={customEnd}
          onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
          showFormFilter selectedForms={selectedForms} onFormsChange={onFormsChange}
          availableForms={availableForms}
          showBackButton onBack={onBack}
        />
      </div>

      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-0.5">
            <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
            {agent.risk && <StatusBadge label="At Risk" variant="bad" />}
          </div>
          <p className="text-sm text-slate-500">{agent.dept} · {period}</p>
        </div>

        {/* 6 Headline Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: 'QA Score', value: agent.qa != null ? `${agent.qa.toFixed(1)}%` : '—', color: agent.qa != null ? (agent.qa >= 90 ? 'text-emerald-600' : agent.qa >= 80 ? 'text-slate-700' : 'text-red-600') : 'text-slate-400' },
            { label: 'Trend',    value: agent.trend, color: agent.trend.startsWith('+') ? 'text-emerald-600' : agent.trend.startsWith('-') ? 'text-red-500' : 'text-slate-500' },
            { label: 'Cadence',  value: `${agent.cadence}/${agent.expected}`, color: agent.cadence >= agent.expected ? 'text-emerald-600' : agent.cadence >= agent.expected * 0.75 ? 'text-orange-500' : 'text-red-600' },
            { label: 'Quiz Score', value: `${agent.quiz}%`, color: agent.quiz >= 80 ? 'text-emerald-600' : agent.quiz >= 70 ? 'text-orange-500' : 'text-red-600' },
            { label: 'Disputes',  value: String(agent.disputes), color: agent.disputes === 0 ? 'text-emerald-600' : agent.disputes >= 3 ? 'text-red-600' : 'text-orange-500' },
            { label: 'Write-Ups', value: String(agent.writeups), color: agent.writeups === 0 ? 'text-emerald-600' : 'text-red-600' },
          ].map(t => (
            <div key={t.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center">
              <div className="text-[11px] text-slate-500 mb-1">{t.label}</div>
              <div className={`text-xl font-bold ${t.color}`}>{t.value}</div>
            </div>
          ))}
        </div>

        {/* ── Quality ── */}
        <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-[#00aeef]">Quality</div>

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
          <InsightsSection title="QA Score Trend">
            <TrendChart data={qaTrend} color="#00aeef" goalValue={90} height={110} metricLabel="%" />
            <div className="mt-3 space-y-0">
              <StatRow label="Total Evaluations" value={String(profile?.recentAudits.length ?? 0)} />
              <StatRow label="Highest Score" value={fmtN(profile?.recentAudits.reduce((m, a) => Math.max(m, a.score ?? 0), 0) || null, '%')} valueColor="text-emerald-600" />
              <StatRow label="Lowest Score"  value={fmtN(profile?.recentAudits.filter(a => a.score != null).reduce((m, a) => Math.min(m, a.score!), 100) || null, '%')} valueColor="text-red-600" />
            </div>
          </InsightsSection>
          <InsightsSection title="Dispute Activity">
            <StatRow label="Total Disputes Filed" value={String(ds?.total ?? 0)} valueColor={(ds?.total ?? 0) > 0 ? 'text-orange-500' : 'text-emerald-600'} />
            <StatRow label="Upheld (Agent Correct)" value={String(ds?.upheld ?? 0)} />
            <StatRow label="Rejected"               value={String(ds?.rejected ?? 0)} />
            <StatRow label="Adjusted"               value={String(ds?.adjusted ?? 0)} />
            <StatRow label="Avg Resolution Time"    value={fmtN(ds?.avgResolutionDays, ' days')} />
          </InsightsSection>
        </div>

        <InsightsSection title="Forms Performance" description="Click a form to see individual review scores.">
          {formSummary.length === 0 && <p className="text-sm text-slate-400 py-3">No evaluations in this period.</p>}
          {formSummary.map(f => (
            <ExpandableRow
              key={f.form} isExpanded={expandedForm === f.form}
              onToggle={() => setExpandedForm(expandedForm === f.form ? null : f.form)}
              summary={
                <div className="flex items-center gap-4 flex-1">
                  <span className="font-medium text-slate-800 flex-1">{f.form}</span>
                  <span className={`font-semibold ${scoreColor(f.avg)}`}>{fmtN(f.avg, '%')} avg</span>
                  <span className="text-xs text-slate-400">{f.count} reviews</span>
                </div>
              }
              detail={
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-400 border-b border-slate-200">
                    {['Review Date','Call Date','Score'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-4">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {f.reviews.map(r => (
                      <tr key={r.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 pr-4">{r.date}</td>
                        <td className="py-1.5 pr-4 text-slate-400">{r.callDate ?? '—'}</td>
                        <td className={`py-1.5 font-semibold ${scoreColor(r.score)}`}>{r.score != null ? `${r.score.toFixed(1)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          ))}
        </InsightsSection>

        <InsightsSection title={`Category Performance — ${selectedForms.length ? selectedForms[0] : 'All Forms'}`}>
          {catScores.length === 0 ? <p className="text-sm text-slate-400 py-2">No category data.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                {['Category','Avg Score','vs Goal','Status'].map(h => <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>)}
              </tr></thead>
              <tbody>
                {catScores.map(c => {
                  const goal = 90; const delta = c.avgScore != null ? c.avgScore - goal : null
                  return (
                    <tr key={c.category} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-slate-800">{c.category}</td>
                      <td className={`py-2 pr-4 font-semibold ${scoreColor(c.avgScore)}`}>{fmtN(c.avgScore, '%')}</td>
                      <td className={`py-2 pr-4 font-medium ${delta != null && delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{delta != null ? (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—'}</td>
                      <td className="py-2"><StatusBadge label={!delta || delta >= 0 ? 'On Track' : delta >= -10 ? 'Near Goal' : 'Below Goal'} variant={!delta || delta >= 0 ? 'good' : delta >= -10 ? 'warning' : 'bad'} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </InsightsSection>

        {/* ── Coaching ── */}
        <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-purple-500">Coaching</div>

        <InsightsSection title="Coaching Summary">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-center">
            {[
              { label: 'Cadence', value: `${agent.cadence}/${agent.expected}`, color: agent.cadence >= agent.expected ? 'text-emerald-600' : 'text-orange-500' },
              { label: 'Total Sessions',value: String(profile?.coachingSessions.length ?? 0), color: 'text-slate-800' },
              { label: 'Completed', value: String(profile?.coachingSessions.filter(s => s.status === 'COMPLETED' || s.status === 'CLOSED').length ?? 0), color: 'text-emerald-600' },
              { label: 'Pending', value: String(profile?.coachingSessions.filter(s => s.status === 'SCHEDULED' || s.status === 'IN_PROCESS').length ?? 0), color: 'text-orange-500' },
            ].map(t => (
              <div key={t.label} className="bg-slate-50 rounded-lg py-2.5">
                <div className="text-[11px] text-slate-400 mb-0.5">{t.label}</div>
                <div className={`text-lg font-bold ${t.color}`}>{t.value}</div>
              </div>
            ))}
          </div>

          <div className="text-[13px] font-semibold text-slate-700 mb-2">Coaching Sessions</div>
          {(!profile?.coachingSessions.length)
            ? <p className="text-sm text-emerald-600">No coaching sessions this period.</p>
            : (
              <table className="w-full text-xs mb-4">
                <thead><tr className="text-slate-400 border-b border-slate-200">
                  {['Date','Topics Covered','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-4">{h}</th>)}
                </tr></thead>
                <tbody>
                  {profile.coachingSessions.map(s => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-slate-700">{s.date}</td>
                      <td className="py-2 pr-4">
                        {s.topics.map((t, i) => (
                          <span key={i} className="inline-block mr-2">
                            <span className="font-medium text-slate-700">{t}</span>
                            {(topicCounts.get(t) ?? 0) >= 2 && (
                              <span className="text-[10px] text-red-600 font-bold ml-1">({topicCounts.get(t)}× in period)</span>
                            )}
                          </span>
                        ))}
                      </td>
                      <td className="py-2"><StatusBadge label={s.status === 'COMPLETED' || s.status === 'CLOSED' ? 'Completed' : 'Pending'} variant={s.status === 'COMPLETED' || s.status === 'CLOSED' ? 'good' : 'warning'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }

          {topicCounts.size > 0 && (
            <>
              <div className="text-[13px] font-semibold text-slate-700 mb-2">Topic Frequency</div>
              {[...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => (
                <div key={topic} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0 text-xs">
                  <span className="font-medium text-slate-700">{topic}</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${count >= 3 ? 'text-red-600' : count >= 2 ? 'text-orange-500' : 'text-slate-600'}`}>{count}×</span>
                    <StatusBadge label={count >= 2 ? 'Repeat' : 'First'} variant={count >= 2 ? 'bad' : 'good'} />
                  </div>
                </div>
              ))}
            </>
          )}
        </InsightsSection>

        <InsightsSection title="Quiz Performance">
          <div className="mb-3 space-y-0">
            <StatRow label="Quiz Score"   value={`${agent.quiz}%`} valueColor={agent.quiz >= 80 ? 'text-emerald-600' : agent.quiz >= 70 ? 'text-orange-500' : 'text-red-600'} />
            <StatRow label="Pass Rate"    value={fmtN((profile?.quizzes.filter(q => q.passed).length ?? 0) / Math.max(profile?.quizzes.length ?? 1, 1) * 100, '%')} />
            <StatRow label="Avg Attempts" value={fmtN(profile?.quizzes.length ? profile.quizzes.reduce((s, q) => s + q.attempts, 0) / profile.quizzes.length : null)} />
          </div>
          <p className="text-xs text-slate-400 mb-2">Click to expand quiz details.</p>
          {(!profile?.quizzes.length)
            ? <p className="text-sm text-emerald-600">No quiz attempts this period.</p>
            : profile.quizzes.map(q => (
              <ExpandableRow
                key={q.id} isExpanded={expandedQuiz === String(q.id)}
                onToggle={() => setExpandedQuiz(expandedQuiz === String(q.id) ? null : String(q.id))}
                summary={
                  <div className="flex items-center gap-4 flex-1">
                    <span className="font-medium text-slate-800 flex-1">{q.quiz}</span>
                    <span className={`font-semibold ${scoreColor(q.score)}`}>{q.score.toFixed(1)}%</span>
                    <StatusBadge label={q.passed ? 'Passed' : 'Failed'} variant={q.passed ? 'good' : 'bad'} />
                  </div>
                }
                detail={
                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div><span className="text-slate-400">Score: </span><span className={`font-bold ${scoreColor(q.score)}`}>{q.score.toFixed(1)}%</span></div>
                    <div><span className="text-slate-400">Attempts: </span><span className={`font-bold ${q.attempts > 1 ? 'text-orange-500' : 'text-emerald-600'}`}>{q.attempts}</span></div>
                    <div><span className="text-slate-400">Date: </span><span>{q.date}</span></div>
                    <div><span className="text-slate-400">Result: </span><span className={`font-bold ${q.passed ? 'text-emerald-600' : 'text-red-600'}`}>{q.passed ? 'Pass' : 'Fail'}</span></div>
                  </div>
                }
              />
            ))
          }
        </InsightsSection>

        {/* ── Warnings ── */}
        <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-red-500">Performance Warnings</div>

        <InsightsSection title="Write-Up History">
          {wus.length === 0 ? (
            <div className="py-6 text-center">
              <CheckCircle size={32} className="text-emerald-500 mx-auto mb-2" />
              <div className="text-emerald-600 text-sm font-semibold">No write-ups on record</div>
              <div className="text-xs text-slate-400 mt-1">This agent has no performance warnings for the selected period.</div>
              <div className="mt-4 space-y-0">
                <StatRow label="Prior Write-Ups (All Time)" value="0" valueColor="text-emerald-600" />
                <StatRow label="Current Status" value="Clean Record" valueColor="text-emerald-600" />
              </div>
            </div>
          ) : (
            <>
              <table className="w-full text-xs mb-4 overflow-x-auto">
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
                      <td className="py-2 text-slate-400 max-w-[140px] truncate">{w.policies.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <StatRow label="Total Write-Ups (Period)"  value={String(wus.length)} valueColor="text-orange-500" />
              <StatRow label="Pending Follow-Ups"       value={String(wus.filter(w => w.status === 'FOLLOW_UP_PENDING').length)} />
              <StatRow label="Policies Cited"           value={[...new Set(wus.flatMap(w => w.policies))].join(', ') || '—'} />
            </>
          )}
        </InsightsSection>
      </div>
    </div>
  )
}
