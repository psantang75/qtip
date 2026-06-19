/**
 * AI Reviewer Inbox
 *
 * One screen for QA to:
 *   1. Promote AI Reviewer DRAFTs into SUBMITTED human-attributed
 *      submissions (Calibrating-mode forms).
 *   2. Re-audit a sampled SUBMITTED AI submission as a calibration
 *      data point (Trusted-mode forms).
 *
 * Backend: GET /api/ai-reviewer/inbox returns both buckets in one
 * call. Each row's "Review" action routes the user to AuditFormPage
 * with the appropriate `?promoteDraft=` or `?calibrationOverlayFor=`
 * query param so the existing form-fill UI does the actual work.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Bot, FileEdit, AlertTriangle, Eye } from 'lucide-react'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import aiReviewerService, { type AiInboxItem, type AiInboxSampleItem } from '@/services/aiReviewerService'

function relativeAge(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return '—'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function AIReviewInbox() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { message?: string } }

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ai-reviewer-inbox'],
    queryFn: () => aiReviewerService.getInbox(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })

  const drafts = data?.drafts_awaiting_promotion ?? []
  const samples = data?.samples_awaiting_review ?? []

  const goPromote = (item: AiInboxItem) => {
    navigate(`/app/quality/audit?promoteDraft=${item.submission_id}`)
  }
  const goOverlay = (item: AiInboxSampleItem) => {
    navigate(`/app/quality/audit?calibrationOverlayFor=${item.submission_id}`)
  }

  return (
    <ListPageShell>
      <ListPageHeader
        title="AI Review Inbox"
        subtitle="Promote AI drafts or re-audit Trusted-mode samples to feed the calibration loop."
      />

      {location.state?.message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">
          {location.state.message}
        </div>
      )}

      {isLoading && <ListLoadingSkeleton rows={5} />}
      {isError && <TableErrorState message="Couldn't load AI inbox. Refresh to try again." onRetry={refetch} />}

      {!isLoading && !isError && (
        <>
          <ListCard>
            <div className="px-4 pt-3 pb-2 flex items-center gap-2">
              <FileEdit className="h-4 w-4 text-amber-600" />
              <h2 className="text-[14px] font-semibold text-slate-900">
                AI Drafts Awaiting Promotion
              </h2>
              <span className="text-[12px] text-slate-500">({drafts.length})</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submission</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.length === 0 ? (
                  <TableEmptyState
                    colSpan={5}
                    icon={Bot}
                    title="No AI drafts waiting"
                    description="AI Reviewer drafts on Calibrating-mode forms will land here for QA review."
                  />
                ) : (
                  drafts.map((d) => (
                    <TableRow key={d.submission_id}>
                      <TableCell className="font-mono text-[12px]">#{d.submission_id}</TableCell>
                      <TableCell className="text-[13px]">{d.form_name}</TableCell>
                      <TableCell className="font-mono text-[12px]">{d.source_label || '—'}</TableCell>
                      <TableCell className="text-[12px] text-slate-500">{relativeAge(d.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => goPromote(d)} className="bg-primary hover:bg-primary/90 text-white">
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Review &amp; Promote
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ListCard>

          <ListCard>
            <div className="px-4 pt-3 pb-2 flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-600" />
              <h2 className="text-[14px] font-semibold text-slate-900">
                Trusted-Mode Samples Awaiting Review
              </h2>
              <span className="text-[12px] text-slate-500">({samples.length})</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submission</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {samples.length === 0 ? (
                  <TableEmptyState
                    colSpan={7}
                    icon={Bot}
                    title="No samples queued"
                    description="Trusted-mode AI submissions sampled for review (or auto-routed because of a low score) will appear here."
                  />
                ) : (
                  samples.map((s) => (
                    <TableRow key={s.submission_id}>
                      <TableCell className="font-mono text-[12px]">#{s.submission_id}</TableCell>
                      <TableCell className="text-[13px]">{s.form_name}</TableCell>
                      <TableCell className="font-mono text-[12px]">{s.source_label || '—'}</TableCell>
                      <TableCell className="font-mono text-[12px]">{s.total_score ?? '—'}</TableCell>
                      <TableCell>
                        {s.routing_reason === 'low_score' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3" />
                            Below cap
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                            Random sample
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[12px] text-slate-500">{relativeAge(s.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => goOverlay(s)}>
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Re-audit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ListCard>
        </>
      )}
    </ListPageShell>
  )
}
