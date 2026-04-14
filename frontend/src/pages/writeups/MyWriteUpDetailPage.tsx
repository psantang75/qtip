import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileText, Loader2 } from 'lucide-react'
import SignatureCanvas from 'react-signature-canvas'
import writeupService from '@/services/writeupService'
import type { WriteUpDetail } from '@/services/writeupService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { ContentSections } from './writeup-detail/ContentSections'
import { WRITE_UP_TYPE_LABELS as TYPE_LABELS } from './writeupLabels'
import { openWriteUpPdf } from './writeup-pdf/openPdf'

const ACK_TEXT = `By signing below, the employee acknowledges receipt of this Corrective Action Form.`

// ── Status banner for non-signing statuses ────────────────────────────────────

function StatusBanner({ writeup }: { writeup: WriteUpDetail }) {
  const { status } = writeup

  if (status === 'DRAFT' || status === 'SCHEDULED') {
    return (
      <div className="mx-auto max-w-3xl px-4 mb-4">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-[13px] text-slate-600">
            {status === 'SCHEDULED' && writeup.meeting_date
              ? `This document has been scheduled for delivery on ${formatQualityDate(writeup.meeting_date)}.`
              : 'This document is in draft and has not yet been scheduled.'}
          </p>
        </div>
      </div>
    )
  }

  if (status === 'FOLLOW_UP_PENDING') {
    return (
      <div className="mx-auto max-w-3xl px-4 mb-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-[13px] text-amber-700">
            A follow-up has been assigned.
            {writeup.follow_up_date && ` Due: ${formatQualityDate(writeup.follow_up_date)}.`}
          </p>
        </div>
      </div>
    )
  }

  if (status === 'CLOSED') {
    return (
      <div className="mx-auto max-w-3xl px-4 mb-4">
        <div className="bg-slate-100 border border-slate-200 rounded-xl p-4">
          <p className="text-[13px] text-slate-600">
            This document is closed and archived.
            {writeup.closed_at && ` Closed on ${formatQualityDate(writeup.closed_at)}.`}
          </p>
        </div>
      </div>
    )
  }

  return null
}

// ── Signature section (AWAITING_SIGNATURE) ────────────────────────────────────

function SignatureSection({ id, csrName, onSigned }: { id: number; csrName: string; onSigned: () => void }) {
  const { toast }   = useToast()
  const sigRef      = useRef<SignatureCanvas>(null)
  const [acked, setAcked] = useState(false)

  const signMut = useMutation({
    mutationFn: () => {
      const sig = sigRef.current
      if (!sig || sig.isEmpty()) throw new Error('Please provide your signature')
      return writeupService.signWriteUp(id, { signature_data: sig.toDataURL('image/png') })
    },
    onSuccess: () => {
      toast({ title: 'Document signed successfully. A copy has been saved to your personnel record.' })
      onSigned()
    },
    onError: (err: Error) => toast({ title: 'Signing failed', description: err?.message, variant: 'destructive' }),
  })

  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 space-y-5">
        <h3 className="text-[14px] font-semibold text-amber-900">Acknowledgment & Signature Required</h3>

        <div className="bg-white rounded-lg border border-amber-200 p-4">
          <p className="text-[13px] text-slate-700 leading-relaxed">{ACK_TEXT}</p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            id="ack-checkbox"
            checked={acked}
            onCheckedChange={v => setAcked(!!v)}
            className="mt-0.5"
          />
          <span className="text-[13px] text-slate-700">
            I have read and understand the above statement.
          </span>
        </label>

        <div>
          <p className="text-[13px] font-medium text-slate-700 mb-2">Sign here:</p>
          <div className="bg-white rounded-lg border-2 border-amber-300 overflow-hidden">
            <SignatureCanvas
              ref={sigRef}
              penColor="#1a1a1a"
              canvasProps={{ className: 'w-full', height: 140, style: { width: '100%', height: 140 } }}
            />
          </div>
          <Button type="button" variant="ghost" size="sm"
            className="mt-1.5 text-[12px] text-slate-400 hover:text-slate-600 h-auto py-1"
            onClick={() => sigRef.current?.clear()}>
            Clear signature
          </Button>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-amber-200">
          <p className="text-[12px] text-slate-500">{csrName}</p>
          <Button
            className="bg-primary hover:bg-primary/90 text-white"
            disabled={!acked || signMut.isPending}
            onClick={() => signMut.mutate()}
          >
            {signMut.isPending ? 'Submitting…' : 'Submit Signature'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Signed section ────────────────────────────────────────────────────────────

function SignedSection({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-[14px] font-semibold text-green-800">
            Document Signed
            {writeup.signed_at && ` — ${formatQualityDate(writeup.signed_at)}`}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-green-200 p-4">
          <p className="text-[13px] text-slate-700 leading-relaxed">{ACK_TEXT}</p>
        </div>

        {writeup.signature_data && (
          <div>
            <p className="text-[12px] text-slate-500 mb-2">Signature on file:</p>
            <div className="bg-white rounded-lg border border-green-200 p-3 inline-block">
              <img src={writeup.signature_data} alt="Signature" className="max-h-[100px]" />
            </div>
            {writeup.signed_at && (
              <p className="text-[11px] text-slate-400 italic mt-2">
                Signed: {new Date(writeup.signed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {writeup.signed_ip ? ` | IP: ${writeup.signed_ip}` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyWriteUpDetailPage() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { toast } = useToast()
  const [pdfLoading, setPdfLoading] = useState(false)

  const { data: writeup, isLoading, isError, refetch } = useQuery({
    queryKey: ['writeup', id],
    queryFn:  () => writeupService.getWriteUpById(Number(id)),
    enabled:  !!id,
    staleTime: 0,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['writeup', id] })
    qc.invalidateQueries({ queryKey: ['my-writeups'] })
  }

  const handleViewPdf = async () => {
    if (!writeup) return
    setPdfLoading(true)
    try { await openWriteUpPdf(writeup) }
    catch { toast({ title: 'PDF generation failed', variant: 'destructive' }) }
    finally { setPdfLoading(false) }
  }

  if (isLoading) return <QualityListPage><TableLoadingSkeleton rows={8} /></QualityListPage>
  if (isError || !writeup) return (
    <QualityListPage>
      <TableErrorState message="Failed to load write-up." onRetry={refetch} />
    </QualityListPage>
  )

  const meetingDate = writeup.meeting_date
    ? formatQualityDate(writeup.meeting_date)
    : formatQualityDate(writeup.created_at)

  return (
    <QualityListPage>
      <div className="mx-auto max-w-3xl px-4">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-200 px-8 py-6 bg-slate-50">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
              QTIP — Employee Corrective Action Form
            </p>
            <h1 className="text-[22px] font-bold text-slate-900 mb-4">
              {TYPE_LABELS[writeup.document_type] ?? writeup.document_type}
            </h1>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Employee</p>
                <p className="text-[13px] font-semibold text-slate-800">{writeup.csr_name}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Date</p>
                <p className="text-[13px] font-semibold text-slate-800">{meetingDate}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Issued By</p>
                <p className="text-[13px] font-semibold text-slate-800">{writeup.created_by_name}</p>
              </div>
            </div>
          </div>
          <div className="px-8 py-6 space-y-6">
            <ContentSections writeup={writeup} />
          </div>
        </div>
      </div>

      {/* ── Status banners / signature section ── */}
      <div className="space-y-4 mt-2">
        {writeup.status !== 'AWAITING_SIGNATURE' && writeup.status !== 'SIGNED' && (
          <StatusBanner writeup={writeup} />
        )}
        {writeup.status === 'AWAITING_SIGNATURE' && (
          <SignatureSection
            id={Number(id)}
            csrName={writeup.csr_name}
            onSigned={() => { invalidate(); navigate('/app/performancewarnings/my') }}
          />
        )}
        {writeup.status === 'SIGNED' && <SignedSection writeup={writeup} />}
      </div>

      {/* ── Footer ── */}
      <div className="mx-auto max-w-3xl px-4">
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" onClick={() => navigate('/app/performancewarnings/my')}>
            ← Back to My Write-Ups
          </Button>
          <Button variant="outline" disabled={pdfLoading} onClick={handleViewPdf}>
            {pdfLoading
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Generating…</>
              : <><FileText className="h-4 w-4 mr-1.5" /> View PDF</>}
          </Button>
        </div>
      </div>
    </QualityListPage>
  )
}
