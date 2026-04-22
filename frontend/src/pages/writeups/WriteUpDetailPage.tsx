import { useParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import { Copy, Pencil, FileText, Loader2 } from 'lucide-react'
import { useWriteUpRole } from '@/hooks/useWriteUpRole'
import writeupService, { type WriteUpPayload } from '@/services/writeupService'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { ContentSections } from './writeup-detail/ContentSections'
import { StatusPanel } from './writeup-detail/StatusPanel'
import { useWriteUpDetail } from './writeup-detail/useWriteUpDetail'

const LOCKED_STATUSES = ['AWAITING_SIGNATURE', 'SIGNED', 'FOLLOW_UP_PENDING', 'CLOSED'] as const

export default function WriteUpDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { canManage: canEdit } = useWriteUpRole()

  const { writeup, isLoading, isError, refetch, invalidate, pdfLoading, handleViewPdf } =
    useWriteUpDetail(id, [['writeups']])

  const duplicateMut = useMutation({
    mutationFn: async () => {
      if (!writeup) throw new Error('No data')
      const payload: WriteUpPayload = {
        csr_id:              writeup.csr_id,
        document_type:       writeup.document_type,
        corrective_action:   writeup.corrective_action ?? null,
        correction_timeline: writeup.correction_timeline ?? null,
        consequence:         writeup.consequence ?? null,
      }
      return writeupService.createWriteUp(payload)
    },
    onSuccess: ({ id: newId }) => {
      toast({ title: 'Performance Warning duplicated as new draft' })
      navigate(`/app/performancewarnings/${newId}`)
    },
    onError: () => toast({ title: 'Duplicate failed', variant: 'destructive' }),
  })

  if (isLoading) return <ListPageShell><ListLoadingSkeleton rows={10} /></ListPageShell>
  if (isError || !writeup) return (
    <ListPageShell>
      <TableErrorState message="Failed to load performance warning." onRetry={refetch} />
    </ListPageShell>
  )

  const isEditable = !LOCKED_STATUSES.includes(writeup.status as typeof LOCKED_STATUSES[number])

  return (
    <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>
      <div className="shrink-0 px-6 pt-6 pb-5">
        <ListPageHeader
          title={`Performance Warning #${writeup.id}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/app/performancewarnings')}>
                ← Performance Warnings
              </Button>
              {canEdit && isEditable && (
                <Button variant="outline" size="sm"
                  onClick={() => navigate(`/app/performancewarnings/${id}/edit`)}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={pdfLoading} onClick={handleViewPdf}>
                {pdfLoading
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</>
                  : <><FileText className="h-3.5 w-3.5 mr-1.5" /> View PDF</>}
              </Button>
              {canEdit && (
                <Button variant="outline" size="sm"
                  onClick={() => duplicateMut.mutate()} disabled={duplicateMut.isPending}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  {duplicateMut.isPending ? 'Copying…' : 'Duplicate'}
                </Button>
              )}
            </div>
          }
        />
      </div>

      <div className="flex-1 min-h-0 px-6 pb-6">
        <div className="grid grid-cols-3 gap-6 h-full">
          <div className="col-span-2 overflow-y-auto space-y-4 pr-2">
            <ContentSections writeup={writeup} id={Number(id)} onInvalidate={invalidate} />
          </div>
          <div className="col-span-1 overflow-y-auto space-y-4 pl-2">
            <StatusPanel writeup={writeup} id={Number(id)} onInvalidate={invalidate} />
          </div>
        </div>
      </div>
    </div>
  )
}
