import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { RichTextDisplay } from '@/components/common/RichTextDisplay'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import { cn } from '@/lib/utils'
import writeupService from '@/services/writeupService'
import userService from '@/services/userService'
import type { WriteUpDetail, WriteUpStatus, TransitionExtra } from '@/services/writeupService'
import { WRITE_UP_STATUS_LABELS as STATUS_LABELS } from '../writeupLabels'

function getTimeline(writeup: WriteUpDetail): string[] {
  const base = ['DRAFT', 'SCHEDULED', 'AWAITING_SIGNATURE', 'SIGNED']
  if (writeup.follow_up_required || writeup.status === 'FOLLOW_UP_PENDING') {
    return [...base, 'FOLLOW_UP_PENDING', 'CLOSED']
  }
  return [...base, 'CLOSED']
}

// ── Status timeline ───────────────────────────────────────────────────────────

function StatusTimeline({ writeup }: { writeup: WriteUpDetail }) {
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

type ActionState = 'schedule' | 'finalize_confirm' | 'recall_confirm' | 'follow_up' | 'close_followup' | null

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
        Edit Write-Up
      </Button>
    </div>
  )
}

function ScheduledActions({ writeup, id, transition, busy }: { writeup: WriteUpDetail; id: number; transition: (s: WriteUpStatus, extra?: TransitionExtra) => void; busy: boolean }) {
  const navigate = useNavigate()
  const [show, setShow]   = useState(false)
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="space-y-3">
      {writeup.meeting_date && (
        <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
          <p className="text-[11px] text-primary uppercase tracking-wide font-medium mb-1">Meeting Date</p>
          <p className="text-[14px] font-semibold text-slate-800">{formatQualityDate(writeup.meeting_date)}</p>
        </div>
      )}
      {show ? (
        <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
          <p className="text-[12px] font-medium text-slate-600">Meeting Notes</p>
          <RichTextEditor className="text-[13px]" placeholder="Record what occurred in the meeting…"
            value={notes} onChange={setNotes} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setShow(false)}>Cancel</Button>
            <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-white"
              disabled={busy || !notes.trim()} onClick={() => setConfirm(true)}>
              Finalize & Send to Agent
            </Button>
          </div>
        </div>
      ) : (
        <Button className="w-full bg-primary hover:bg-primary/90 text-white h-9 text-[13px]"
          onClick={() => setShow(true)}>
          Complete & Send for Signature
        </Button>
      )}
      <Button variant="outline" className="w-full h-9 text-[13px]"
        onClick={() => navigate(`/app/performancewarnings/${id}/edit`)}>
        Edit Write-Up
      </Button>
      <ConfirmDialog
        open={confirm} loading={busy}
        title="Finalize Write-Up"
        message={`This will lock the document and send it to ${writeup.csr_name} for signature. Continue?`}
        onConfirm={() => { setConfirm(false); transition('AWAITING_SIGNATURE', { meeting_notes: notes }) }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}

function AwaitingSignatureActions({ writeup, id, transition, busy }: { writeup: WriteUpDetail; id: number; transition: (s: WriteUpStatus, extra?: TransitionExtra) => void; busy: boolean }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)

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
    </div>
  )
}

function SignedActions({ writeup, id, onSetFollowUp, transition, busy }: {
  writeup: WriteUpDetail; id: number
  onSetFollowUp: (body: { follow_up_date: string; follow_up_assigned_to: number; follow_up_checklist: string }) => void
  transition: (s: WriteUpStatus, extra?: TransitionExtra) => void; busy: boolean
}) {
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [fuDate, setFuDate]     = useState('')
  const [fuUser, setFuUser]     = useState('')
  const [fuNotes, setFuNotes]   = useState('')

  const { data: managersData } = useQuery({
    queryKey: ['managers-for-followup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 5 }),
    staleTime: Infinity,
  })
  const managers = managersData?.items ?? []

  return (
    <div className="space-y-3">
      <div className="p-3 bg-green-50 rounded-lg border border-green-200">
        <p className="text-[12px] text-green-700">
          Signed by <strong>{writeup.csr_name}</strong>
          {writeup.signed_at ? ` on ${formatQualityDate(writeup.signed_at)}` : ''}.
        </p>
      </div>
      <Button className="w-full bg-primary hover:bg-primary/90 text-white h-9 text-[13px]"
        onClick={() => transition('CLOSED')} disabled={busy}>
        {busy ? 'Saving…' : 'Close — No Follow-Up Needed'}
      </Button>
      {showFollowUp ? (
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <p className="text-[12px] font-semibold text-slate-600">Set Follow-Up</p>
          <Input type="date" className="h-8 text-[13px]" placeholder="Follow-up date"
            value={fuDate} onChange={e => setFuDate(e.target.value)} />
          <Select value={fuUser} onValueChange={setFuUser}>
            <SelectTrigger className="h-8 text-[13px]">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              {managers.map(m => (
                <SelectItem key={m.id} value={String(m.id)}>{m.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RichTextEditor className="text-[13px]" placeholder="Follow-up checklist…"
            value={fuNotes} onChange={setFuNotes} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowFollowUp(false)}>Cancel</Button>
            <Button size="sm" className="flex-1 bg-primary hover:bg-primary/90 text-white"
              disabled={!fuDate || !fuUser || busy}
              onClick={() => onSetFollowUp({ follow_up_date: fuDate, follow_up_assigned_to: Number(fuUser), follow_up_checklist: fuNotes })}>
              {busy ? 'Saving…' : 'Set Follow-Up'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full h-9 text-[13px]"
          onClick={() => setShowFollowUp(true)}>
          Requires Follow-Up
        </Button>
      )}
    </div>
  )
}

function FollowUpPendingActions({ writeup, transition, busy }: { writeup: WriteUpDetail; transition: (s: WriteUpStatus, extra?: TransitionExtra) => void; busy: boolean }) {
  const [notes, setNotes] = useState(writeup.follow_up_notes ?? '')

  return (
    <div className="space-y-3">
      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-1">
        {writeup.follow_up_date && (
          <p className="text-[12px] text-amber-700">
            Due: <strong>{formatQualityDate(writeup.follow_up_date)}</strong>
          </p>
        )}
        {writeup.follow_up_checklist && (
          <RichTextDisplay html={writeup.follow_up_checklist} className="text-[12px] text-amber-700" />
        )}
      </div>
      <div className="space-y-1">
        <p className="text-[12px] font-medium text-slate-600">Follow-Up Notes</p>
        <RichTextEditor className="text-[13px]"
          placeholder="What happened at the check-in?"
          value={notes} onChange={setNotes} />
      </div>
      <Button className="w-full bg-primary hover:bg-primary/90 text-white h-9 text-[13px]"
        onClick={() => transition('CLOSED', { follow_up_notes: notes })}
        disabled={busy || (!notes.trim() && !writeup.follow_up_notes)}>
        {busy ? 'Saving…' : 'Add Notes & Close Document'}
      </Button>
    </div>
  )
}

function ClosedBanner({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <div className="p-3 bg-slate-100 rounded-lg border border-slate-200">
      <p className="text-[12px] font-semibold text-slate-600 mb-0.5">Document Closed</p>
      {writeup.closed_at && (
        <p className="text-[11px] text-slate-400">{formatQualityDate(writeup.closed_at)}</p>
      )}
      {writeup.follow_up_notes && (
        <RichTextDisplay html={writeup.follow_up_notes} className="text-[12px] text-slate-600 mt-2" />
      )}
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

  const setFollowUpMut = useMutation({
    mutationFn: (body: { follow_up_date: string; follow_up_assigned_to: number; follow_up_checklist: string }) =>
      writeupService.setFollowUp(id, body),
    onSuccess: () => onSuccess('Follow-up set'),
    onError: (err: Error) => toast({ title: 'Update failed', description: err?.message, variant: 'destructive' }),
  })

  const transition = (status: WriteUpStatus, extra?: TransitionExtra) =>
    transitionMut.mutate({ status, extra })
  const busy = transitionMut.isPending || setFollowUpMut.isPending

  const actionProps = { writeup, id, transition, busy }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sticky top-6 space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-slate-800 border-b border-slate-100 pb-2.5 mb-3">
          Status
        </h3>
        <StatusTimeline writeup={writeup} />
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Actions</p>

        {writeup.status === 'DRAFT'               && <DraftActions {...actionProps} />}
        {writeup.status === 'SCHEDULED'           && <ScheduledActions {...actionProps} />}
        {writeup.status === 'AWAITING_SIGNATURE'  && <AwaitingSignatureActions {...actionProps} />}
        {writeup.status === 'SIGNED'              && (
          <SignedActions {...actionProps}
            onSetFollowUp={body => setFollowUpMut.mutate(body)} />
        )}
        {writeup.status === 'FOLLOW_UP_PENDING'   && <FollowUpPendingActions {...actionProps} />}
        {writeup.status === 'CLOSED'              && <ClosedBanner writeup={writeup} />}
      </div>
    </div>
  )
}
