import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import SignatureCanvas from 'react-signature-canvas'
import writeupService from '@/services/writeupService'
import type { WriteUpDetail } from '@/services/writeupService'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate, formatQualityDateTime } from '@/utils/dateFormat'

const ACK_TEXT = `By signing below, the employee acknowledges receipt of this Corrective Action Form.`

// ── Status banner for non-signing statuses ────────────────────────────────────

export function StatusBanner({ writeup }: { writeup: WriteUpDetail }) {
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

export function SignatureSection({ id, csrName, onSigned }: { id: number; csrName: string; onSigned: () => void }) {
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

export function SignedSection({ writeup }: { writeup: WriteUpDetail }) {
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
                Signed: {formatQualityDateTime(writeup.signed_at)}
                {writeup.signed_ip ? ` | IP: ${writeup.signed_ip}` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Refused section (SIGNATURE_REFUSED, or CLOSED with a refusal) ────────────
//
// Mirrors SignedSection so the agent always sees a "signature block" in the
// same spot as a signed warning. Replaces the empty signature image with a
// stamped refusal notice plus the recorded reason.

export function RefusedSection({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-rose-600 shrink-0" />
          <p className="text-[14px] font-semibold text-rose-800">
            Signature Refused
            {writeup.refused_at && ` — ${formatQualityDate(writeup.refused_at)}`}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-rose-200 p-4">
          <p className="text-[13px] text-slate-700 leading-relaxed">{ACK_TEXT}</p>
        </div>

        <div>
          <p className="text-[12px] text-slate-500 mb-2">Signature on file:</p>
          <div className="bg-white rounded-lg border border-rose-200 p-4 inline-block">
            <p className="text-[13px] font-semibold text-rose-700 uppercase tracking-wider">
              Refused to sign or approve this performance warning
            </p>
          </div>
          {writeup.refused_at && (
            <p className="text-[11px] text-slate-400 italic mt-2">
              Recorded: {formatQualityDateTime(writeup.refused_at)}
            </p>
          )}
        </div>

        {writeup.refusal_reason && (
          <div className="bg-white rounded-lg border border-rose-200 p-4">
            <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-widest mb-1">
              Reason for Refusal
            </p>
            <p className="text-[13px] text-slate-700 whitespace-pre-line leading-relaxed">
              {writeup.refusal_reason}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
