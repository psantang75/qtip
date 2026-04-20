import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import writeupService from '@/services/writeupService'
import type { WriteUpDetail, WriteUpStatus, TransitionExtra } from '@/services/writeupService'
import { WRITE_UP_STATUS_LABELS as STATUS_LABELS } from '@/constants/labels'

function getTimeline(writeup: WriteUpDetail): string[] {
  // Follow-up path: SIGNED/SIGNATURE_REFUSED → FOLLOW_UP_PENDING → FOLLOW_UP_COMPLETED → CLOSED.
  // Non-follow-up path: SIGNED/SIGNATURE_REFUSED → CLOSED.
  // SIGNATURE_REFUSED occupies the same slot as SIGNED so the manager can see
  // where the document stalled even after recording the refusal.
  const base = ['DRAFT', 'SCHEDULED', 'AWAITING_SIGNATURE']
  const isRefused = writeup.status === 'SIGNATURE_REFUSED' || !!writeup.refused_at
  const milestone = isRefused ? 'SIGNATURE_REFUSED' : 'SIGNED'
  const isFollowUp =
    writeup.follow_up_required ||
    writeup.status === 'FOLLOW_UP_PENDING' ||
    writeup.status === 'FOLLOW_UP_COMPLETED'
  if (isFollowUp && (writeup.status === 'SIGNED' || writeup.status === 'SIGNATURE_REFUSED')) {
    return [...base, milestone, 'FOLLOW_UP_PENDING', 'FOLLOW_UP_COMPLETED', 'CLOSED']
  }
  if (isFollowUp) {
    return [...base, 'FOLLOW_UP_PENDING', 'FOLLOW_UP_COMPLETED', 'CLOSED']
  }
  return [...base, milestone, 'CLOSED']
}

// ── Status timeline ───────────────────────────────────────────────────────────

export function StatusTimeline({ writeup }: { writeup: WriteUpDetail }) {
  const steps   = getTimeline(writeup)
  const current = steps.indexOf(writeup.status)

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const isDone    = i < current
        const isCurrent = i === current
        const isPending = i > current
        return (
          <div key={step} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className={cn('h-5 w-5 rounded-full flex items-center justify-center mt-0.5 shrink-0',
                isDone    && 'bg-primary text-white',
                isCurrent && 'bg-primary/20 border-2 border-primary',
                isPending && 'border-2 border-slate-200 bg-white'
              )}>
                {isDone && <CheckCircle2 className="h-3 w-3" />}
                {isCurrent && <span className="h-2 w-2 rounded-full bg-primary block" />}
                {isPending && <Circle className="h-2.5 w-2.5 text-slate-300" />}
              </div>
              {i < steps.length - 1 && (
                <div className={cn('w-0.5 h-6 mt-0.5', isDone ? 'bg-primary/30' : 'bg-slate-100')} />
              )}
            </div>
            <p className={cn('text-[12px] pt-0.5 pb-6 leading-snug',
              isCurrent ? 'font-semibold text-slate-800' : isPending ? 'text-slate-400' : 'text-slate-500'
            )}>
              {STATUS_LABELS[step]}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Dated history (training-style) ────────────────────────────────────────────

export function StatusHistory({ writeup }: { writeup: WriteUpDetail }) {
  const rows: Array<{ label: string; date: string }> = []
  if (writeup.created_at)   rows.push({ label: 'Created',            date: writeup.created_at })
  if (writeup.meeting_date) rows.push({ label: 'Meeting',            date: writeup.meeting_date })
  if (writeup.delivered_at) rows.push({ label: 'Sent for Signature', date: writeup.delivered_at })
  if (writeup.signed_at)    rows.push({ label: 'Signed',             date: writeup.signed_at })
  if (writeup.refused_at)   rows.push({ label: 'Signature Refused',  date: writeup.refused_at })
  if (writeup.follow_up_required && writeup.follow_up_date) {
    rows.push({ label: writeup.status === 'CLOSED' ? 'Follow-Up' : 'Follow-Up Due', date: writeup.follow_up_date })
  }
  if (writeup.follow_up_completed_at) {
    rows.push({ label: 'Follow-Up Completed', date: writeup.follow_up_completed_at })
  }
  if (writeup.closed_at)    rows.push({ label: 'Closed',             date: writeup.closed_at })

  if (rows.length === 0) return null

  return (
    <div className="space-y-0">
      {rows.map(r => (
        <div key={r.label} className="flex items-start justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
          <span className="text-[12px] font-medium text-slate-500">{r.label}</span>
          <span className="text-[12px] text-slate-700 text-right">{formatQualityDate(r.date)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ open, title, message, onConfirm, onCancel, loading }: {
  open: boolean; title: string; message: string
  onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-slate-600">{message}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-white"
            onClick={onConfirm} disabled={loading}>
            {loading ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Action panels per status ──────────────────────────────────────────────────

function DraftActions({ writeup, id, transition, busy }: { writeup: WriteUpDetail; id: number; transition: (s: WriteUpStatus, extra?: TransitionExtra) => void; busy: boolean }) {
  const navigate = useNavigate()
  const [show, setShow] = useState(false)
  const [date, setDate] = useState(writeup.meeting_date?.slice(0,10) ?? '')

  return (
    <div className="space-y-2">
      {show ? (
        <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <p className="text-[12px] font-medium text-slate-600">Meeting Date</p>
          <Input type="date" className="h-8 text-[13px]" value={date} onChange={e => setDate(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setShow(false)}>Cancel</Button>
            <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-white"
              disabled={!date || busy}
              onClick={() => transition('SCHEDULED', { meeting_date: date })}>
              {busy ? 'Saving…' : 'Schedule'}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="w-full bg-primary hover:bg-primary/90 text-white h-9 text-[13px]"
          onClick={() => setShow(true)}>
          Schedule Meeting
        </Button>
      )}
      <Button variant="outline" className="w-full h-9 text-[13px]"
        onClick={() => navigate(`/app/performancewarnings/${id}/edit`)}>
        Edit Performance Warning
      </Button>
    </div>
  )
}

function ScheduledActions({ writeup, id }: { writeup: WriteUpDetail; id: number }) {
  const navigate = useNavigate()
  return (
    <div className="space-y-3">
      {writeup.meeting_date && (
        <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
          <p className="text-[11px] text-primary uppercase tracking-wide font-medium mb-1">Meeting Date</p>
          <p className="text-[14px] font-semibold text-slate-800">{formatQualityDate(writeup.meeting_date)}</p>
        </div>
      )}
      <p className="text-[12px] text-slate-500 italic">
        Record meeting notes and finalize the document from the Next Action card below.
      </p>
      <Button variant="outline" className="w-full h-9 text-[13px]"
        onClick={() => navigate(`/app/performancewarnings/${id}/edit`)}>
        Edit Performance Warning
      </Button>
    </div>
  )
}

function AwaitingSignatureActions({ writeup, id, transition, busy }: { writeup: WriteUpDetail; id: number; transition: (s: WriteUpStatus, extra?: TransitionExtra) => void; busy: boolean }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [refuseOpen, setRefuseOpen] = useState(false)
  const [refusalReason, setRefusalReason] = useState('')

  return (
    <div className="space-y-3">
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-[12px] text-blue-700">
          Document sent to <strong>{writeup.csr_name}</strong>
          {writeup.delivered_at ? ` on ${formatQualityDate(writeup.delivered_at)}` : ''}.
          Awaiting signature.
        </p>
      </div>
      <Button variant="outline" className="w-full h-9 text-[13px] border-red-200 text-red-600 hover:bg-red-50"
        onClick={() => setRefuseOpen(true)}>
        Refuse Signature
      </Button>
      <Button variant="outline" className="w-full h-9 text-[13px] border-amber-200 text-amber-700 hover:bg-amber-50"
        onClick={() => setConfirm(true)}>
        Recall Document
      </Button>
      <Button variant="outline" className="w-full h-9 text-[13px]"
        onClick={() => navigate(`/app/performancewarnings/my/${id}`)}>
        Preview Agent View
      </Button>
      <ConfirmDialog
        open={confirm} loading={busy}
        title="Recall Document"
        message="This will recall the document and return it to Scheduled status. The CSR will no longer be able to sign."
        onConfirm={() => { setConfirm(false); transition('SCHEDULED') }}
        onCancel={() => setConfirm(false)}
      />
      <RefuseSignatureDialog
        open={refuseOpen} loading={busy}
        csrName={writeup.csr_name}
        reason={refusalReason}
        setReason={setRefusalReason}
        onConfirm={() => {
          const trimmed = refusalReason.trim()
          if (!trimmed) return
          setRefuseOpen(false)
          transition('SIGNATURE_REFUSED', { refusal_reason: trimmed })
          setRefusalReason('')
        }}
        onCancel={() => { setRefuseOpen(false); setRefusalReason('') }}
      />
    </div>
  )
}

function RefuseSignatureDialog({
  open, loading, csrName, reason, setReason, onConfirm, onCancel,
}: {
  open: boolean; loading: boolean; csrName: string; reason: string
  setReason: (v: string) => void; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Refuse Signature</DialogTitle></DialogHeader>
        <p className="text-[13px] text-slate-600">
          Record that <strong>{csrName}</strong> declined to sign this document.
          The performance warning continues through its normal close-out workflow.
        </p>
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-slate-600">Reason for Refusal <span className="text-red-500">*</span></p>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Document the circumstances of the refusal…"
            rows={4}
            className="text-[13px]"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
            onClick={onConfirm} disabled={loading || !reason.trim()}>
            {loading ? 'Saving…' : 'Record Refusal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SignedActions({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="space-y-3">
      <div className="p-3 bg-green-50 rounded-lg border border-green-200">
        <p className="text-[12px] text-green-700">
          Signed by <strong>{writeup.csr_name}</strong>
          {writeup.signed_at ? ` on ${formatQualityDate(writeup.signed_at)}` : ''}.
        </p>
      </div>
      <p className="text-[12px] text-slate-500 italic">
        Record internal notes and close the performance warning from the Internal Notes section below.
      </p>
    </div>
  )
}

function SignatureRefusedActions({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="space-y-3">
      <RefusalSummaryCard writeup={writeup} />
      <p className="text-[12px] text-slate-500 italic">
        Record internal notes and close the performance warning from the Internal Notes section below.
      </p>
    </div>
  )
}

/**
 * Persistent rose card summarizing a recorded signature refusal. Rendered at
 * the top of StatusPanel any time `refused_at` is set so the refusal + reason
 * remain visible after the warning is closed.
 */
function RefusalSummaryCard({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="p-3 bg-rose-50 rounded-lg border border-rose-200 space-y-1">
      <p className="text-[12px] font-semibold text-rose-800">Signature Refused</p>
      <p className="text-[12px] text-rose-700">
        <strong>{writeup.csr_name}</strong> declined to sign
        {writeup.refused_at ? ` on ${formatQualityDate(writeup.refused_at)}` : ''}.
      </p>
      {writeup.refusal_reason && (
        <p className="text-[12px] text-rose-700 whitespace-pre-line">
          <span className="font-medium">Reason:</span> {writeup.refusal_reason}
        </p>
      )}
    </div>
  )
}

function FollowUpPendingStatus({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="space-y-3">
      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-1">
        <p className="text-[12px] font-semibold text-amber-800">Follow-Up Pending</p>
        {writeup.follow_up_date && (
          <p className="text-[12px] text-amber-700">
            Due: <strong>{formatQualityDate(writeup.follow_up_date)}</strong>
          </p>
        )}
        {writeup.follow_up_assignee_name && (
          <p className="text-[12px] text-amber-700">
            Meeting with: <strong>{writeup.follow_up_assignee_name}</strong>
          </p>
        )}
      </div>
      <p className="text-[12px] text-slate-500 italic">
        Save follow-up notes from the Follow-Up section and mark the follow-up complete.
      </p>
    </div>
  )
}

function FollowUpCompletedStatus({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="space-y-3">
      <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-1">
        <p className="text-[12px] font-semibold text-green-800">Follow-Up Completed</p>
        {writeup.follow_up_completed_at && (
          <p className="text-[12px] text-green-700">
            Completed on: <strong>{formatQualityDate(writeup.follow_up_completed_at)}</strong>
          </p>
        )}
      </div>
      <p className="text-[12px] text-slate-500 italic">
        Record internal notes and close the performance warning from the Internal Notes section below.
      </p>
    </div>
  )
}

// ── Main StatusPanel ──────────────────────────────────────────────────────────

interface StatusPanelProps {
  writeup: WriteUpDetail
  id: number
  onInvalidate: () => void
}

export function StatusPanel({ writeup, id, onInvalidate }: StatusPanelProps) {
  const { toast } = useToast()
  const qc        = useQueryClient()

  const onSuccess = (msg: string) => {
    toast({ title: msg })
    onInvalidate()
    qc.invalidateQueries({ queryKey: ['writeups'] })
    qc.invalidateQueries({ queryKey: ['my-writeups'] })
  }

  const transitionMut = useMutation({
    mutationFn: ({ status, extra }: { status: WriteUpStatus; extra?: TransitionExtra }) =>
      writeupService.transitionStatus(id, { status, ...extra }),
    onSuccess: (_data, variables) => onSuccess(`Status updated to ${STATUS_LABELS[variables.status]}`),
    onError: (err: Error) => toast({ title: 'Update failed', description: err?.message, variant: 'destructive' }),
  })

  const transition = (status: WriteUpStatus, extra?: TransitionExtra) =>
    transitionMut.mutate({ status, extra })
  const busy = transitionMut.isPending

  // Once a refusal has been recorded, keep the refusal + reason visible for
  // the manager even after the warning moves on to FOLLOW_UP_* or CLOSED. The
  // SIGNATURE_REFUSED status itself already surfaces this card via its
  // dedicated Actions panel below, so we only render the persistent variant
  // for downstream statuses to avoid showing it twice.
  const showPersistentRefusal =
    !!writeup.refused_at && writeup.status !== 'SIGNATURE_REFUSED'

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sticky top-6 space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-slate-800 border-b border-slate-100 pb-2.5 mb-3">
          Status
        </h3>
        <StatusTimeline writeup={writeup} />
      </div>

      {writeup.status !== 'CLOSED' && (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Actions</p>

          {writeup.status === 'DRAFT'               && <DraftActions writeup={writeup} id={id} transition={transition} busy={busy} />}
          {writeup.status === 'SCHEDULED'           && <ScheduledActions writeup={writeup} id={id} />}
          {writeup.status === 'AWAITING_SIGNATURE'  && <AwaitingSignatureActions writeup={writeup} id={id} transition={transition} busy={busy} />}
          {writeup.status === 'SIGNED'              && <SignedActions writeup={writeup} />}
          {writeup.status === 'SIGNATURE_REFUSED'   && <SignatureRefusedActions writeup={writeup} />}
          {writeup.status === 'FOLLOW_UP_PENDING'   && <FollowUpPendingStatus writeup={writeup} />}
          {writeup.status === 'FOLLOW_UP_COMPLETED' && <FollowUpCompletedStatus writeup={writeup} />}
        </div>
      )}

      <div className="border-t border-slate-100 pt-4">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">History</p>
        <StatusHistory writeup={writeup} />
      </div>

      {showPersistentRefusal && (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Signature Review</p>
          <RefusalSummaryCard writeup={writeup} />
        </div>
      )}
    </div>
  )
}
