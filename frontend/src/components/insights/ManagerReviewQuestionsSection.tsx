import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { InsightsSection, ExpandableRow } from '@/components/insights'
import { Button } from '@/components/ui/button'
import type { HiddenQuestionSummary } from '@/services/insightsQCService'
import { answerLabel } from './agentProfileHelpers'

function QuestionSummaryLine({ q }: { q: HiddenQuestionSummary }) {
  if (q.type === 'TEXT') {
    return <span className="text-xs text-slate-700 shrink-0">{q.responses} of {q.total} reviews with a response</span>
  }
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {q.distribution.length === 0
        ? <span className="text-xs text-slate-400">No answers</span>
        : q.distribution.map(d => (
            <span key={d.answer}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border text-slate-600 bg-slate-100 border-slate-200">
              {answerLabel(d.answer)} {d.count}
            </span>
          ))}
    </span>
  )
}

export default function ManagerReviewQuestionsSection({ questions }: { questions: HiddenQuestionSummary[] }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<string | null>(null)

  const byForm = new Map<string, HiddenQuestionSummary[]>()
  for (const q of questions) {
    const list = byForm.get(q.form) ?? []
    list.push(q)
    byForm.set(q.form, list)
  }

  return (
    <InsightsSection title="Hidden Questions Summary" infoKpiCodes={['mr_hidden_questions']}>
      {questions.length === 0
        ? <p className="text-sm text-slate-400 text-center py-4">No hidden-question answers for the selected period.</p>
        : [...byForm.entries()].map(([form, list]) => (
            <div key={form} className="mb-4 last:mb-0">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1.5">{form}</div>
              {list.map(q => {
                const isExp = expanded === q.key
                return (
                  <ExpandableRow
                    key={q.key}
                    isExpanded={isExp}
                    onToggle={() => setExpanded(isExp ? null : q.key)}
                    summary={
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{q.question}</span>
                        <QuestionSummaryLine q={q} />
                      </div>
                    }
                    detail={
                      <div className="pt-1">
                        <div className="flex items-center text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5">
                          <span className="flex-1 min-w-0">Agent</span>
                          <span className="w-40 shrink-0">Department</span>
                          <span className="w-20 shrink-0 text-right">Reviews</span>
                          <span className="w-24 shrink-0 text-right">Responses</span>
                          <span className="w-20 shrink-0 text-right">Notes</span>
                        </div>
                        {q.agents.map(a => (
                          <div key={a.userId} className="flex items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
                            <span className="flex-1 min-w-0">
                              <Button variant="link" onClick={() => navigate(`/app/insights/qc-agents?agent=${a.userId}`)}
                                className="h-auto p-0 text-xs font-medium max-w-full truncate justify-start">
                                {a.name}
                              </Button>
                            </span>
                            <span className="w-40 shrink-0 truncate text-slate-500">{a.dept}</span>
                            <span className="w-20 shrink-0 text-right text-slate-700">{a.total}</span>
                            <span className="w-24 shrink-0 text-right text-slate-700">{a.responses}</span>
                            <span className={`w-20 shrink-0 text-right font-semibold ${a.flagged > 0 ? 'text-primary' : 'text-slate-400'}`}>{a.flagged}</span>
                          </div>
                        ))}
                      </div>
                    }
                  />
                )
              })}
            </div>
          ))}
    </InsightsSection>
  )
}
