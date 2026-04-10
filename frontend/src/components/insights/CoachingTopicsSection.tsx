import { InsightsSection, StatusBadge, ExpandableRow } from '@/components/insights'

interface TopicAgent {
  userId: number
  name: string
  dept: string
  sessions: number
  lastCoached: string | null
  repeat: boolean
}

interface Topic {
  topic: string
  sessions: number
  agents: number
}

interface Props {
  topics: Topic[]
  visibleTopics: Topic[]
  maxTopicSess: number
  expandedTopic: string | null
  onToggleTopic: (topic: string) => void
  topicAgents: TopicAgent[] | undefined
  showAllTopics: boolean
  onToggleShowAll: () => void
  onNavAgent: (userId: number) => void
}

export default function CoachingTopicsSection({
  topics, visibleTopics, maxTopicSess, expandedTopic, onToggleTopic,
  topicAgents, showAllTopics, onToggleShowAll, onNavAgent,
}: Props) {
  return (
    <InsightsSection title="Most Coached Topics">
      <div className="space-y-1">
        {topics.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No coaching data for this period.</p>}
        {visibleTopics.map(t => {
          const barPct = (t.sessions / maxTopicSess) * 100
          return (
            <ExpandableRow
              key={t.topic}
              isExpanded={expandedTopic === t.topic}
              onToggle={() => onToggleTopic(t.topic)}
              summary={
                <div className="flex items-center flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{t.topic}</span>
                  <span className="text-xs text-slate-700 w-20 text-right shrink-0">{t.sessions} Sessions</span>
                  <div className="w-28 bg-slate-100 rounded-full h-2 overflow-hidden shrink-0 ml-4">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="text-xs text-slate-700 w-16 text-right shrink-0 ml-4">{t.agents} Agents</span>
                </div>
              }
              detail={
                <div>
                  {!topicAgents && expandedTopic === t.topic && <p className="text-xs text-slate-400">Loading agents…</p>}
                  {topicAgents && expandedTopic === t.topic && (
                    <table className="w-full text-xs">
                      <thead><tr className="text-slate-400 border-b border-slate-200">
                        {['Agent','Department','Sessions','Last Coached','Repeat?'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {topicAgents.map(a => (
                          <tr key={a.userId} className="border-b border-slate-100 last:border-0 hover:bg-white cursor-pointer" onClick={() => onNavAgent(a.userId)}>
                            <td className="py-2 pr-3 text-primary hover:underline font-medium">{a.name}</td>
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
        })}
      </div>
      {topics.length > 5 && (
        <button onClick={onToggleShowAll} className="mt-3 text-xs text-primary hover:underline">
          {showAllTopics ? 'Show top 5 only' : `Show all ${topics.length} topics`}
        </button>
      )}
    </InsightsSection>
  )
}
