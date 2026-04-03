import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Printer } from 'lucide-react'
import SignatureCanvas from 'react-signature-canvas'
import writeupService from '@/services/writeupService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { ContentSections } from './writeup-detail/ContentSections'
import { WRITE_UP_TYPE_LABELS as TYPE_LABELS } from './writeupLabels'

// ── Acknowledgment text ───────────────────────────────────────────────────────

const ACK_TEXT = `I acknowledge receipt of this document. My signature does not constitute agreement with the contents of this document. I understand that a copy will be placed in my personnel file. This document does not alter the at-will nature of my employment.`

// ── Status banner for non-signing statuses ────────────────────────────────────

function StatusBanner({ writeup }: { writeup: Awaited<ReturnType<typeof writeupService.getWriteUpById>> }) {
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

  if (status === 'DELIVERED') {
    return (
      <div className="mx-auto max-w-3xl px-4 mb-4">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <p className="text-[13px] text-indigo-700">
            Your manager has delivered this document. It is awaiting finalization before being sent to you for signature.
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
    onError: (err: any) => toast({ title: 'Signing failed', description: err?.message, variant: 'destructive' }),
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

function SignedSection({ writeup }: { writeup: Awaited<ReturnType<typeof writeupService.getWriteUpById>> }) {
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
      {/* ── Document card ─────────────────────────────────────────────────── */}
      <div className="writeup-print-root mx-auto max-w-3xl px-4 print:px-0">
        <div className="wu-print-doc bg-white rounded-xl border border-slate-200 overflow-hidden">

          {/* ── Screen header ── */}
          <div className="border-b border-slate-200 px-8 py-6 bg-slate-50 print:hidden">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
              QTIP — Employee Performance Document
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

          {/* ── Print-only header ── */}
          <div className="wu-print-header hidden print:block">
            <div className="wu-print-header-brand">
              <div className="wu-print-header-brand-bar" />
              <div>
                <p className="wu-print-header-org">QTIP — Employee Performance Document</p>
                <p className="wu-print-header-title">{TYPE_LABELS[writeup.document_type] ?? writeup.document_type}</p>
              </div>
            </div>
            <div className="wu-print-header-meta">
              <div>
                <p className="wu-print-meta-item-label">Employee</p>
                <p className="wu-print-meta-item-value">{writeup.csr_name}</p>
              </div>
              <div>
                <p className="wu-print-meta-item-label">Issued By</p>
                <p className="wu-print-meta-item-value">{writeup.created_by_name}</p>
              </div>
              <div>
                <p className="wu-print-meta-item-label">Meeting Date</p>
                <p className="wu-print-meta-item-value">{meetingDate}</p>
              </div>
              <div>
                <p className="wu-print-meta-item-label">Status</p>
                <p className="wu-print-meta-item-value">{writeup.status.replace(/_/g, ' ')}</p>
              </div>
            </div>
          </div>

          {/* Document body */}
          <div className="px-8 py-6 space-y-6">
            <ContentSections writeup={writeup} />
          </div>

          {/* ── Print-only acknowledgment + signature block ── */}
          <div className="hidden print:block px-8 pb-8">
            <p className="wu-print-ack">{ACK_TEXT}</p>
            <div className="wu-print-sig">
              <div>
                <div className="wu-print-sig-line">
                  {writeup.signature_data && (
                    <img src={writeup.signature_data} alt="Signature" className="wu-print-sig-image" />
                  )}
                </div>
                <p className="wu-print-sig-label">Employee Signature — {writeup.csr_name}</p>
              </div>
              <div>
                <div className="wu-print-sig-line" />
                <p className="wu-print-sig-label">
                  Date Signed: {writeup.signed_at ? formatQualityDate(writeup.signed_at) : '_______________'}
                </p>
              </div>
            </div>
            <div className="wu-print-footer">
              <span>Write-Up #{writeup.id} — Confidential HR Document</span>
              <span>Generated {formatQualityDate(new Date().toISOString())}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Status banners / signature section (screen only) ──────────────── */}
      <div className="print:hidden space-y-4 mt-2">
        {writeup.status !== 'AWAITING_SIGNATURE' && writeup.status !== 'SIGNED' && (
          <StatusBanner writeup={writeup} />
        )}
        {writeup.status === 'AWAITING_SIGNATURE' && (
          <SignatureSection
            id={Number(id)}
            csrName={writeup.csr_name}
            onSigned={() => { invalidate(); navigate('/app/writeups/my') }}
          />
        )}
        {writeup.status === 'SIGNED' && <SignedSection writeup={writeup} />}
      </div>

      {/* ── Footer (screen only) ──────────────────────────────────────────── */}
      <div className="print:hidden mx-auto max-w-3xl px-4">
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" onClick={() => navigate('/app/writeups/my')}>
            ← Back to My Write-Ups
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Print / Save PDF
          </Button>
        </div>
      </div>
    </QualityListPage>
  )
}
