import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatQualityDate } from '@/utils/dateFormat'
import { TopicList } from '@/components/common/DetailLayout'
import type { RecentSession } from '@/services/trainingService'

function SessionRows({ sessions }: { sessions: RecentSession[] }) {
  return (
    <div className="space-y-0">
      {sessions.map(s => (
        <div key={s.id} className="grid grid-cols-[90px_1fr] gap-4 py-3 border-b border-slate-100 last:border-0 items-start">
          <span className="text-[11px] text-slate-400 pt-0.5 whitespace-nowrap">
            {formatQualityDate(s.session_date)}
          </span>
          <TopicList topics={s.topics} />
        </div>
      ))}
    </div>
  )
}

function RepeatTopicsBadge({ topics }: { topics: string[] }) {
  if (!topics.length) return null
  return (
    <div className="mt-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Coached 2+ times in 90 days</p>
      <ul className="space-y-1 pl-3">
        {topics.map(t => (
          <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Shared sidebar panel ─────────────────────────────────────────────────────

interface AgentHistoryPanelProps {
  agentName?: string
  recentSessions: RecentSession[]
  priorYearSessions: RecentSession[]
  repeatTopics: string[]
  loading?: boolean
  noAgentMessage?: string
}

export function AgentHistoryPanel({
  agentName, recentSessions, priorYearSessions, repeatTopics, loading, noAgentMessage,
}: AgentHistoryPanelProps) {
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const hasSessions = recentSessions.length > 0

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-4 sticky top-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Prior Sessions</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {agentName ? `${agentName} — past 90 days` : 'Past 90 days'}
            </p>
          </div>
          {hasSessions && (
            <Button variant="ghost" size="sm" className="text-[12px] text-primary h-auto p-0 hover:bg-transparent"
              onClick={() => setShowModal(true)}>
              View Prior Year
            </Button>
          )}
        </div>

        {noAgentMessage ? (
          <p className="text-[13px] text-slate-400">{noAgentMessage}</p>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : !hasSessions ? (
          <p className="text-[13px] text-slate-400">No sessions in the past 90 days</p>
        ) : (
          <>
            <SessionRows sessions={recentSessions.slice(0, 5)} />
            <RepeatTopicsBadge topics={repeatTopics} />
          </>
        )}
      </div>

      <PriorYearModal
        open={showModal}
        onOpenChange={setShowModal}
        agentName={agentName}
        sessions={priorYearSessions}
        repeatTopics={repeatTopics}
        onViewAgentSessions={agentName
          ? () => { setShowModal(false); navigate(`/app/training/coaching?agents=${encodeURIComponent(agentName)}`) }
          : undefined
        }
      />
    </>
  )
}

// ── Shared modal ─────────────────────────────────────────────────────────────

interface PriorYearModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentName?: string
  sessions: RecentSession[]
  repeatTopics: string[]
  onViewAgentSessions?: () => void
}

export function PriorYearModal({ open, onOpenChange, agentName, sessions, repeatTopics, onViewAgentSessions }: PriorYearModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Prior Year{agentName ? ` — ${agentName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 pr-1">
          {sessions.length === 0 ? (
            <p className="text-[13px] text-slate-400 py-4 text-center">No sessions in the prior year</p>
          ) : (
            <SessionRows sessions={sessions} />
          )}
          <RepeatTopicsBadge topics={repeatTopics} />
        </div>
        {onViewAgentSessions && (
          <div className="border-t border-slate-100 pt-3 mt-1">
            <Button variant="outline" size="sm" className="w-full text-[13px]" onClick={onViewAgentSessions}>
              View Agent's Sessions
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
