import { useParams, useNavigate } from 'react-router-dom'
import { CalendarClock, FileText, Loader2 } from 'lucide-react'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { ContentSections } from './writeup-detail/ContentSections'
import { StatusBanner, SignatureSection, SignedSection, RefusedSection } from './writeup-detail/AgentSections'
import { useWriteUpDetail } from './writeup-detail/useWriteUpDetail'
import { formatQualityDate } from '@/utils/dateFormat'

export default function MyWriteUpDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { writeup, isLoading, isError, refetch, invalidate, pdfLoading, handleViewPdf } =
    useWriteUpDetail(id, [['my-writeups']])

  if (isLoading) return <ListPageShell><ListLoadingSkeleton rows={8} /></ListPageShell>
  if (isError || !writeup) return (
    <ListPageShell>
      <TableErrorState message="Failed to load performance warning." onRetry={refetch} />
    </ListPageShell>
  )

  const isDraft     = writeup.status === 'DRAFT'
  const isScheduled = writeup.status === 'SCHEDULED'
  const showDetails = !isDraft && !isScheduled

  return (
    <ListPageShell>
      <ListPageHeader
        title={`Performance Warning #${writeup.id}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/app/performancewarnings/my')}>
              ← My Performance Warnings
            </Button>
            {showDetails && (
              <Button variant="outline" size="sm" disabled={pdfLoading} onClick={handleViewPdf}>
                {pdfLoading
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</>
                  : <><FileText className="h-3.5 w-3.5 mr-1.5" /> View PDF</>}
              </Button>
            )}
          </div>
        }
      />

      {isDraft ? (
        <div className="mx-auto max-w-3xl px-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden p-8 text-center space-y-3">
            <p className="text-[13px] text-slate-500">This document is not yet available.</p>
          </div>
        </div>
      ) : isScheduled ? (
        <div className="mx-auto max-w-3xl px-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden p-8 text-center space-y-4">
            <CalendarClock className="h-10 w-10 text-slate-400 mx-auto" />
            <h2 className="text-[16px] font-semibold text-slate-800">A Meeting Has Been Scheduled</h2>
            <p className="text-[13px] text-slate-500 max-w-md mx-auto">
              {writeup.meeting_date
                ? `Your meeting is scheduled for ${formatQualityDate(writeup.meeting_date)}. Details will be available after the meeting.`
                : 'A meeting is being prepared. Details will be available after the meeting.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="mx-auto max-w-3xl px-4">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-8 py-6 space-y-6">
                <ContentSections writeup={writeup} isAgentView />
              </div>
            </div>
          </div>

          <div className="space-y-4 mt-2">
            {writeup.status === 'AWAITING_SIGNATURE' ? (
              <SignatureSection
                id={Number(id)}
                csrName={writeup.csr_name}
                onSigned={() => { invalidate(); navigate('/app/performancewarnings/my') }}
              />
            ) : writeup.status === 'SIGNED' ? (
              <SignedSection writeup={writeup} />
            ) : writeup.status === 'SIGNATURE_REFUSED' || writeup.refused_at ? (
              <RefusedSection writeup={writeup} />
            ) : (
              <StatusBanner writeup={writeup} />
            )}
          </div>
        </>
      )}
    </ListPageShell>
  )
}
