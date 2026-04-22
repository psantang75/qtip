import { InsightsSection, StatusBadge, ExpandableRow } from '@/components/insights'

interface RepeatTopic {
  topic: string
  count: number
}

interface RepeatOffender {
  userId: number
  name: string
  dept: string
  sessions: number
  uniqueTopics: number
  repeatTopics: number
  topics: RepeatTopic[]
}

interface Props {
  repeaters: RepeatOffender[]
  expandedAgent: number | null
  onToggleAgent: (userId: number) => void
  onNavAgent: (userId: number) => void
}

export default function CoachingRepeatOffendersSection({
  repeaters, expandedAgent, onToggleAgent, onNavAgent,
}: Props) {
  return (
    <InsightsSection title="Repeat Coaching" infoKpiCodes={['coaching_repeat_offenders']}>
      {repeaters.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No repeat coaching agents for this period.</p>}
      {repeaters.map(a => (
        <ExpandableRow
          key={a.userId}
          isExpanded={expandedAgent === a.userId}
          onToggle={() => onToggleAgent(a.userId)}
          summary={
            <div className="flex items-center flex-1 min-w-0 text-xs">
              <span className="font-medium text-slate-800 w-40 shrink-0 truncate">{a.name}</span>
              <span className="flex-1" />
              <span className="text-slate-700 w-20 text-right shrink-0">{a.sessions} Sessions</span>
              <span className="text-slate-700 w-16 text-right shrink-0 ml-4">{a.uniqueTopics} Topics</span>
              <span className={`font-semibold w-28 text-right shrink-0 ml-4 ${a.repeatTopics >= 2 ? 'text-red-600' : 'text-orange-500'}`}>{a.repeatTopics} Repeat Topics</span>
            </div>
          }
          detail={
            <div className="pt-1">
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_4rem_5rem] text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5 gap-x-5">
                <span>Topic</span><span>Department</span><span className="text-right">Sessions</span><span className="text-right">Status</span>
              </div>
              {(a.topics ?? []).map(t => (
                <div key={t.topic} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_4rem_5rem] items-center text-xs py-2 border-b border-slate-100 last:border-0 gap-x-5">
                  <span className="font-medium text-slate-700 truncate">{t.topic}</span>
                  <span className="text-slate-500">{a.dept}</span>
                  <span className={`font-semibold text-right ${t.count >= 3 ? 'text-red-600' : t.count >= 2 ? 'text-orange-500' : 'text-slate-600'}`}>{t.count}×</span>
                  <span className="text-right"><StatusBadge label={t.count >= 2 ? 'Repeat' : 'First'} variant={t.count >= 2 ? 'bad' : 'good'} /></span>
                </div>
              ))}
              <button onClick={() => onNavAgent(a.userId)} className="text-[11px] text-primary hover:underline mt-2">View full agent profile →</button>
            </div>
          }
        />
      ))}
    </InsightsSection>
  )
}
