import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Target, Download, CheckCircle } from 'lucide-react'
import trainingService, { type CoachingSession, type CoachingSourceType } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import { CoachingTypeBadge, TopicChips } from './CoachingSessionsPage'

// ── Local helpers ─────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<CoachingSourceType, string> = {
  QA_AUDIT: 'QA Audit', MANAGER_OBSERVATION: 'Manager Obs.', TREND: 'Trend',
  DISPUTE: 'Dispute', SCHEDULED: 'Scheduled', OTHER: 'Other',
}

function SourceBadge({ source }: { source: CoachingSourceType }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
      {SOURCE_LABELS[source] ?? source}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-[13px] text-slate-800 font-medium">{value ?? '—'}</p>
    </div>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-slate-200 p-5', className)}>{children}</div>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-700 mb-3">{children}</h3>
}

// ── Right-panel helpers ───────────────────────────────────────────────────────

function StatusRow({ label, content, muted }: { label: string; content: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className={cn('text-[13px]', muted ? 'text-slate-400' : 'text-slate-600')}>{label}</span>
      <span className={cn('text-[13px] text-right', muted ? 'text-slate-400' : 'text-slate-700')}>{content}</span>
    </div>
  )
}

function QuizStatus({ session }: { session: CoachingSession }) {
  if (!session.quiz_required) return <span className="text-[13px] text-slate-400">— Not required</span>
  const attempts = session.quiz_attempts ?? []
  const passed = attempts.find(a => a.passed)
  if (passed) return <span className="text-[13px] text-emerald-700">✅ Passed {Number(passed.score).toFixed(0)}%</span>
  if (attempts.length) {
    const best = Math.max(...attempts.map(a => Number(a.score)))
    return <span className="text-[13px] text-amber-700">⚠️ Failed {best.toFixed(0)}% — {attempts.length} attempt{attempts.length > 1 ? 's' : ''}</span>
  }
  if (session.status === 'QUIZ_PENDING') return <span className="text-[13px] text-amber-600">⏳ Not started</span>
  return <span className="text-[13px] text-slate-400">—</span>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CoachingSessionDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()

  const { data: session, isLoading, isError } = useQuery({
    queryKey: ['coaching-session', id],
    queryFn:  () => trainingService.getCoachingSessionDetail(Number(id)),
    enabled:  !!id,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['coaching-session', id] })

  const deliverMut = useMutation({
    mutationFn: () => trainingService.deliverSession(Number(id)),
    onSuccess: () => { toast({ title: 'Session delivered' });      invalidate() },
    onError:   () => toast({ title: 'Error', description: 'Could not mark as delivered.', variant: 'destructive' }),
  })
  const followMut = useMutation({
    mutationFn: () => trainingService.flagFollowUp(Number(id)),
    onSuccess: () => { toast({ title: 'Follow-up flagged' });      invalidate() },
    onError:   () => toast({ title: 'Error', description: 'Could not flag follow-up.', variant: 'destructive' }),
  })
  const closeMut = useMutation({
    mutationFn: () => trainingService.closeSession(Number(id)),
    onSuccess: () => { toast({ title: 'Session closed' });         invalidate() },
    onError:   () => toast({ title: 'Error', description: 'Could not close session.', variant: 'destructive' }),
  })

  const handleDownload = async () => {
    if (!session?.attachment_filename) return
    try {
      const blob = URL.createObjectURL(await trainingService.downloadAttachment(Number(id)))
      const a = Object.assign(document.createElement('a'), { href: blob, download: session.attachment_filename })
      a.click(); URL.revokeObjectURL(blob)
    } catch { toast({ title: 'Download failed', variant: 'destructive' }) }
  }

  const canEdit = session && !['COMPLETED', 'CLOSED'].includes(session.status)
  const isAnyPending = deliverMut.isPending || followMut.isPending || closeMut.isPending

  if (isLoading) return <QualityListPage><TableLoadingSkeleton rows={10} /></QualityListPage>
  if (isError || !session) return (
    <QualityListPage>
      <TableErrorState message="Failed to load session." onRetry={() => qc.invalidateQueries({ queryKey: ['coaching-session', id] })} />
    </QualityListPage>
  )

  const recentSessions = session.recent_sessions ?? []
  const repeatTopics   = new Set(session.repeat_topics ?? [])

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Coaching Session"
        subtitle={`${session.csr_name} — ${formatQualityDate(session.session_date)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/app/training/coaching')}>← Back</Button>
            {canEdit && (
              <Button variant="outline" onClick={() => navigate(`/app/training/coaching/${id}/edit`)}>Edit</Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-6">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">

          {/* Session header */}
          <Card>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <CoachingTypeBadge type={session.coaching_type} />
              <SourceBadge source={session.source_type} />
              <StatusBadge status={session.status} />
              {!!session.is_overdue && <span className="text-[12px] font-semibold text-red-600">Overdue</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <InfoRow label="CSR"          value={session.csr_name} />
              <InfoRow label="Coach"        value={session.created_by_name} />
              <InfoRow label="Session Date" value={formatQualityDate(session.session_date)} />
              <InfoRow label="Due Date"     value={session.due_date ? formatQualityDate(session.due_date) : '—'} />
            </div>
          </Card>

          {/* Notes */}
          <Card>
            <SectionTitle>Session Notes</SectionTitle>
            <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">
              {session.notes || <span className="text-slate-400">No notes provided</span>}
            </p>
            {session.qa_audit_id && (
              <a href={`/app/quality/submissions/${session.qa_audit_id}`}
                className="inline-flex items-center gap-1 text-primary text-[13px] mt-3 hover:underline">
                View QA Audit →
              </a>
            )}
          </Card>

          {/* Required action */}
          <div className="bg-white rounded-xl border-2 border-primary/20 p-5">
            <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
              <Target className="h-4 w-4" /> Required Action
            </h3>
            <p className="text-[13px] text-slate-700">{session.required_action || '—'}</p>
          </div>

          {/* Topics */}
          <Card>
            <SectionTitle>Topics</SectionTitle>
            <TopicChips topics={session.topics} max={20} />
          </Card>

          {/* KB Resource */}
          {(session.kb_resource || session.kb_url) && (
            <Card>
              <SectionTitle>Knowledge Base Resource</SectionTitle>
              {session.kb_resource ? (
                <div className="space-y-1">
                  <a href={session.kb_resource.url} target="_blank" rel="noopener noreferrer"
                    className="text-[13px] font-medium text-primary hover:underline flex items-center gap-1">
                    {session.kb_resource.title} <ExternalLink className="h-3 w-3" />
                  </a>
                  {session.kb_resource.description && (
                    <p className="text-[12px] text-slate-500">{session.kb_resource.description}</p>
                  )}
                  <a href={session.kb_resource.url} target="_blank" rel="noopener noreferrer"
                    className="text-[12px] text-primary hover:underline flex items-center gap-1 mt-2">
                    Open Resource → <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <a href={session.kb_url} target="_blank" rel="noopener noreferrer"
                  className="text-[13px] text-primary hover:underline flex items-center gap-1">
                  {session.kb_url} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </Card>
          )}

          {/* Quiz */}
          {!!session.quiz_required && !!session.quiz && (
            <Card>
              <SectionTitle>Quiz — {session.quiz.quiz_title}</SectionTitle>
              <p className="text-[12px] text-slate-500 mb-3">Pass score: {session.quiz.pass_score}%</p>
              {(session.quiz_attempts?.length ?? 0) > 0 ? (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
                      <th className="pb-2 font-medium">Attempt</th>
                      <th className="pb-2 font-medium">Score</th>
                      <th className="pb-2 font-medium">Result</th>
                      <th className="pb-2 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.quiz_attempts!.map(a => (
                      <tr key={a.id} className={cn('border-b border-slate-50', a.passed ? 'bg-emerald-50/40' : 'bg-red-50/40')}>
                        <td className="py-2">#{a.attempt_number}</td>
                        <td className="py-2">{Number(a.score).toFixed(0)}%</td>
                        <td className="py-2">
                          <span className={cn('text-[11px] font-semibold', a.passed ? 'text-emerald-700' : 'text-red-700')}>
                            {a.passed ? 'PASS ✓' : 'FAIL ✗'}
                          </span>
                        </td>
                        <td className="py-2 text-slate-500">{formatQualityDate(a.submitted_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[13px] text-slate-400">No attempts yet</p>
              )}
            </Card>
          )}

          {/* Attachment */}
          {session.attachment_filename && (
            <Card>
              <SectionTitle>Attachment</SectionTitle>
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-slate-700 truncate mr-3">{session.attachment_filename}</p>
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
              </div>
            </Card>
          )}

        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="col-span-1 space-y-4">

          {/* CSR Response Status */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <SectionTitle>CSR Response</SectionTitle>
            <div className="space-y-3">
              <StatusRow label="Delivered"
                content={session.delivered_at ? formatQualityDate(session.delivered_at) : <span className="text-amber-600">⏳ Not yet</span>} />
              <StatusRow label="Action Plan"
                content={session.csr_action_plan
                  ? <span className="text-emerald-700">✅ Submitted</span>
                  : <span className={session.require_action_plan ? 'text-amber-600' : 'text-slate-400'}>
                      {session.require_action_plan ? '⏳ Pending' : '— Not required'}
                    </span>} />
              <StatusRow label="Acknowledged"
                content={session.csr_acknowledged_at
                  ? <span className="text-emerald-700">✅ {formatQualityDate(session.csr_acknowledged_at)}</span>
                  : <span className={session.require_acknowledgment ? 'text-amber-600' : 'text-slate-400'}>
                      {session.require_acknowledgment ? '⏳ Not yet' : '— Not required'}
                    </span>} />
              <StatusRow label="Quiz" content={<QuizStatus session={session} />} />
              {session.due_date && (
                <StatusRow label="Due"
                  content={<span className={session.is_overdue ? 'text-red-600 font-medium' : ''}>
                    {formatQualityDate(session.due_date)}{session.is_overdue ? ' ⚠' : ''}
                  </span>} />
              )}
            </div>

            {session.csr_action_plan && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                <p className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Action Plan</p>
                <p className="text-[13px] text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 leading-relaxed">
                  {session.csr_action_plan}
                </p>
                {session.csr_root_cause && (
                  <p className="text-[12px] text-slate-500">Root cause: {session.csr_root_cause}</p>
                )}
                {session.csr_support_needed && (
                  <p className="text-[12px] text-slate-500">Support needed: {session.csr_support_needed}</p>
                )}
                {session.csr_acknowledged_at && (
                  <p className="text-[11px] text-slate-400">Submitted {formatQualityDate(session.csr_acknowledged_at)}</p>
                )}
              </div>
            )}
          </div>

          {/* Coaching History */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <SectionTitle>Prior Sessions — {session.csr_name}</SectionTitle>
            {recentSessions.length === 0 ? (
              <p className="text-[13px] text-slate-400">First session with this CSR</p>
            ) : (
              <div className="space-y-3">
                {recentSessions.map(s => {
                  const hasRepeat = s.topics.some(t => repeatTopics.has(t))
                  return (
                    <div key={s.id} className="pb-3 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[12px] text-slate-500">{formatQualityDate(s.session_date)}</span>
                        {hasRepeat && <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" title="Repeat topic" />}
                        <CoachingTypeBadge type={s.coaching_type} />
                      </div>
                      <TopicChips topics={s.topics} max={3} />
                    </div>
                  )
                })}
                <a href={`/app/training/coaching?csrs=${session.csr_id}`}
                  className="text-[12px] text-primary hover:underline">
                  View all →
                </a>
              </div>
            )}
          </div>

          {/* Actions */}
          {['SCHEDULED', 'COMPLETED', 'FOLLOW_UP_REQUIRED'].includes(session.status) && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
              <SectionTitle>Actions</SectionTitle>
              {session.status === 'SCHEDULED' && (
                <Button className="w-full bg-primary hover:bg-primary/90 text-white"
                  onClick={() => deliverMut.mutate()} disabled={isAnyPending}>
                  {deliverMut.isPending ? 'Updating…' : 'Mark Delivered'}
                </Button>
              )}
              {session.status === 'COMPLETED' && (
                <Button variant="outline" className="w-full"
                  onClick={() => followMut.mutate()} disabled={isAnyPending}>
                  {followMut.isPending ? 'Updating…' : 'Flag for Follow-Up'}
                </Button>
              )}
              {session.status === 'FOLLOW_UP_REQUIRED' && (
                <>
                  <Button variant="outline" className="w-full"
                    onClick={() => followMut.mutate()} disabled={isAnyPending}>
                    {followMut.isPending ? 'Updating…' : 'Re-flag Follow-Up'}
                  </Button>
                  <Button variant="outline" className="w-full border-slate-300"
                    onClick={() => closeMut.mutate()} disabled={isAnyPending}>
                    {closeMut.isPending ? 'Closing…' : 'Close Session'}
                  </Button>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </QualityListPage>
  )
}
