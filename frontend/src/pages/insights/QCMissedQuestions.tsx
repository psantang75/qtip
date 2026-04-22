import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { ExpandableRow, InsightsSection } from '@/components/insights'
import type { MissedQuestion } from '@/services/insightsQCService'

interface Props {
  questions: MissedQuestion[]
}

export default function QCMissedQuestions({ questions }: Props) {
  const navigate  = useNavigate()
  const [expanded, setExpanded] = useState<number | null>(null)

  if (questions.length === 0) {
    return (
      <InsightsSection title="Top Missed Questions" infoKpiCodes={['top_missed_questions']}>
        <p className="text-sm text-slate-400 text-center py-6">No data for the selected period.</p>
      </InsightsSection>
    )
  }

  return (
    <InsightsSection title="Top Missed Questions" infoKpiCodes={['top_missed_questions']}>
      {questions.map((q) => {
        const barPct = Math.min(q.missRate, 100)
        return (
          <ExpandableRow
            key={q.questionId}
            isExpanded={expanded === q.questionId}
            onToggle={() => setExpanded(expanded === q.questionId ? null : q.questionId)}
            summary={
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-[13px] font-medium text-slate-800 truncate flex-1">{q.question}</span>
                <span className="text-xs text-slate-400 shrink-0">{q.form}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-400"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-red-600 w-10 text-right">{q.missRate}%</span>
                  <span className="text-[11px] text-slate-400 w-14 text-right">{q.missed}/{q.total}</span>
                </div>
              </div>
            }
            detail={
              q.agents.length === 0 ? (
                <p className="text-xs text-slate-400">No agent data available.</p>
              ) : (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertCircle size={12} className="text-orange-500" />
                    <span className="text-xs font-semibold text-slate-600">Agents who missed this question</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-200">
                        <th className="text-left py-1 font-medium">Agent</th>
                        <th className="text-left py-1 font-medium">Department</th>
                        <th className="text-right py-1 font-medium">Missed / Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.agents.map(agent => (
                        <tr
                          key={agent.userId}
                          className="border-b border-slate-100 last:border-0 hover:bg-slate-100 cursor-pointer"
                          onClick={() =>
                            navigate(`/app/insights/qc-agents?agent=${agent.userId}`)
                          }
                        >
                          <td className="py-1.5 text-primary hover:underline">{agent.name}</td>
                          <td className="py-1.5 text-slate-500">{agent.dept}</td>
                          <td className="py-1.5 text-right text-slate-600 font-medium">{agent.missed}/{agent.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          />
        )
      })}
    </InsightsSection>
  )
}
