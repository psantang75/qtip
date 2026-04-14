import { InsightsSection, StatusBadge } from '@/components/insights'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatQualityDate } from '@/utils/dateFormat'
import { COACHING_PURPOSE_LABELS, COACHING_FORMAT_LABELS } from '@/constants/labels'
import type { AgentProfile } from '@/services/insightsQCService'

interface Props {
  coachingSessions: AgentProfile['coachingSessions']
  topicCounts: Map<string, number>
}

export default function AgentCoachingSection({ coachingSessions, topicCounts }: Props) {
  return (
    <>
      <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-primary">Coaching</div>

      <InsightsSection title="Coaching Sessions">
        <TooltipProvider delayDuration={200}>
        {(!coachingSessions.length)
          ? <p className="text-sm text-slate-400 py-3 text-center">No coaching sessions this period.</p>
          : (
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 border-b border-slate-200">
                {['Date','Purpose','Format','Topics','Status'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-4">{h}</th>)}
              </tr></thead>
              <tbody>
                {coachingSessions.map(s => {
                  const fmtDate = formatQualityDate(s.date)
                  const purposeLabel = COACHING_PURPOSE_LABELS[s.purpose as keyof typeof COACHING_PURPOSE_LABELS] ?? s.purpose
                  const formatLabel = COACHING_FORMAT_LABELS[s.format as keyof typeof COACHING_FORMAT_LABELS] ?? (s.format || '—')
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
    </>
  )
}
