import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatQualityDate } from '@/utils/dateFormat'
import writeupService, {
  type WriteUpDetail,
  type WriteUpStatus,
  type TransitionExtra,
} from '@/services/writeupService'
import userService from '@/services/userService'
import { WRITE_UP_STATUS_LABELS as STATUS_LABELS } from '@/constants/labels'

interface ActionCardProps {
  writeup: WriteUpDetail
  id: number
  onInvalidate: () => void
}

/**
 * Bottom-of-main-column card hosting the data-entry flow for performance warnings.
 * Only rendered for management roles at SCHEDULED status. Agents never see it.
 *
 * SIGNED and FOLLOW_UP_PENDING closeout flows live inside the Internal Notes
 * section (see ContentSections.InternalNotesEditableSection) so managers
 * record internal notes before closing.
 */
export function ActionCard({ writeup, id, onInvalidate }: ActionCardProps) {
  if (writeup.status !== 'SCHEDULED') return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-800">Next Action</h3>
      </div>
      <div className="p-5">
        <ScheduledFlow writeup={writeup} id={id} onInvalidate={onInvalidate} />
      </div>
    </div>
  )
}

function useOnSuccess(onInvalidate: () => void) {
  const { toast } = useToast()
  const qc = useQueryClient()
  return (msg: string) => {
    toast({ title: msg })
    onInvalidate()
    qc.invalidateQueries({ queryKey: ['writeups'] })
    qc.invalidateQueries({ queryKey: ['my-writeups'] })
  }
}

function useTransitionMut(id: number, onInvalidate: () => void) {
  const { toast } = useToast()
  const onSuccess = useOnSuccess(onInvalidate)
  return useMutation({
    mutationFn: ({ status, extra }: { status: WriteUpStatus; extra?: TransitionExtra }) =>
      writeupService.transitionStatus(id, { status, ...extra }),
    onSuccess: (_d, v) => onSuccess(`Status updated to ${STATUS_LABELS[v.status]}`),
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err?.message, variant: 'destructive' }),
  })
}

// ── SCHEDULED ────────────────────────────────────────────────────────────────

function ScheduledFlow({ writeup, id, onInvalidate }: ActionCardProps) {
  const [notes, setNotes]   = useState('')
  const [confirm, setConfirm] = useState(false)

  // Follow-up fields — captured during the meeting, applied at finalize time.
  const [followUpRequired, setFollowUpRequired] = useState(false)
  const [fuDate,  setFuDate]  = useState('')
  const [fuUser,  setFuUser]  = useState('')
  const [fuCheck, setFuCheck] = useState('')

  const { data: managersData } = useQuery({
    queryKey: ['managers-for-followup'],
    queryFn: () => userService.getUsers(1, 100, { role_id: 5 }),
    staleTime: Infinity,
  })
  const managers = managersData?.items ?? []

  const transitionMut = useTransitionMut(id, onInvalidate)
  const busy = transitionMut.isPending

  const followUpIncomplete = followUpRequired && (!fuDate || !fuUser)
  const submitDisabled     = busy || !notes.trim() || followUpIncomplete

  return (
    <div className="space-y-4">
      {writeup.meeting_date && (
        <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
          <p className="text-[11px] text-primary uppercase tracking-wide font-medium mb-1">Meeting Date</p>
          <p className="text-[14px] font-semibold text-slate-800">{formatQualityDate(writeup.meeting_date)}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[12px] font-medium text-slate-600">Meeting Notes</p>
        <RichTextEditor
          className="text-[13px]"
          placeholder="Record what occurred in the meeting…"
          value={notes}
          onChange={setNotes}
        />
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-3">
        <div className="flex items-center gap-3">
          <Switch checked={followUpRequired} onCheckedChange={setFollowUpRequired} />
          <span className="text-[13px] text-slate-700">Follow-Up Required</span>
        </div>

        {followUpRequired && (
          <div className="space-y-3 pl-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[12px] font-medium text-slate-600">Follow-Up Date</p>
                <Input type="date" className="h-9 text-[13px]" value={fuDate} onChange={e => setFuDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[12px] font-medium text-slate-600">Meeting With</p>
                <Select value={fuUser} onValueChange={setFuUser}>
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Select attendee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {managers.map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-slate-600">Follow Up Focus <span className="text-slate-400 font-normal">(optional)</span></p>
              <RichTextEditor
                className="text-[13px]"
                placeholder="What should be verified at the follow-up?"
                value={fuCheck}
                onChange={setFuCheck}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          className="bg-primary hover:bg-primary/90 text-white h-9 text-[13px]"
          disabled={submitDisabled}
          onClick={() => setConfirm(true)}
        >
          Complete &amp; Send for Signature
        </Button>
      </div>

      <Dialog open={confirm} onOpenChange={o => !o && setConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Finalize Performance Warning</DialogTitle></DialogHeader>
          <p className="text-[13px] text-slate-600">
            This will lock the document and send it to <strong>{writeup.csr_name}</strong> for signature.
            {followUpRequired && ' After they sign, the performance warning will move to follow-up.'} Continue?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-white"
              disabled={busy}
              onClick={() => {
                setConfirm(false)
                transitionMut.mutate({
                  status: 'AWAITING_SIGNATURE',
                  extra: {
                    meeting_notes: notes,
                    follow_up_required:    followUpRequired,
                    follow_up_date:        followUpRequired ? fuDate          : null,
                    follow_up_assigned_to: followUpRequired ? Number(fuUser)  : null,
                    follow_up_checklist:   followUpRequired ? (fuCheck || null) : null,
                  },
                })
              }}
            >
              {busy ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ActionCard
