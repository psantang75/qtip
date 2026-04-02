import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import { Copy, Pencil } from 'lucide-react'
import writeupService from '@/services/writeupService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { ContentSections } from './writeup-detail/ContentSections'
import { StatusPanel } from './writeup-detail/StatusPanel'

// Document locks at AWAITING_SIGNATURE per backend enforcement
const LOCKED_STATUSES = ['AWAITING_SIGNATURE', 'SIGNED', 'FOLLOW_UP_PENDING', 'CLOSED'] as const

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WriteUpDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()
  const { user }  = useAuth()

  const canEdit = [1, 2, 5].includes(user?.role_id ?? 0)

  const { data: writeup, isLoading, isError } = useQuery({
    queryKey:  ['writeup', id],
    queryFn:   () => writeupService.getWriteUpById(Number(id)),
    enabled:   !!id,
    staleTime: 0,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['writeup', id] })
    qc.invalidateQueries({ queryKey: ['writeups'] })
  }

  const duplicateMut = useMutation({
    mutationFn: async () => {
      if (!writeup) throw new Error('No data')
      return writeupService.createWriteUp({
        csr_id:              writeup.csr_id,
        document_type:       writeup.document_type,
        corrective_action:   writeup.corrective_action ?? undefined,
        correction_timeline: writeup.correction_timeline ?? undefined,
        checkin_date:        writeup.checkin_date ?? undefined,
        consequence:         writeup.consequence ?? undefined,
      } as any)
    },
    onSuccess: ({ id: newId }) => {
      toast({ title: 'Write-up duplicated as new draft' })
      navigate(`/app/writeups/${newId}`)
    },
    onError: () => toast({ title: 'Duplicate failed', variant: 'destructive' }),
  })

  if (isLoading) return <QualityListPage><TableLoadingSkeleton rows={10} /></QualityListPage>
  if (isError || !writeup) return (
    <QualityListPage>
      <TableErrorState message="Failed to load write-up."
        onRetry={() => qc.invalidateQueries({ queryKey: ['writeup', id] })} />
    </QualityListPage>
  )

  // Editable until the document is sent for signature
  const isEditable = !LOCKED_STATUSES.includes(writeup.status as typeof LOCKED_STATUSES[number])

  return (
    <QualityListPage>
      <QualityPageHeader
        title={`Write-Up #${writeup.id}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/app/writeups')}>
              ← Write-Ups
            </Button>
            {canEdit && isEditable && (
              <Button variant="outline" size="sm"
                onClick={() => navigate(`/app/writeups/${id}/edit`)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
              </Button>
            )}
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

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <ContentSections writeup={writeup} />
        </div>
        <div className="col-span-1">
          <StatusPanel writeup={writeup} id={Number(id)} onInvalidate={invalidate} />
        </div>
      </div>
    </QualityListPage>
  )
}
