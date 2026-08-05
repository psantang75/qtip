import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertTriangle, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { unlockService, UNLOCK_MIN_NOTE } from '@/services/unlockService'
import { useUnlockReasons } from '@/hooks/useUnlockReasons'

/**
 * Admin "reopen" confirmation. Mirrors the required-reason refusal dialog in
 * writeups/writeup-detail/StatusPanel.tsx: shadcn Dialog, confirm disabled
 * until the justification is long enough.
 *
 * Two-step for old records: the server answers 409 BEYOND_WINDOW when the
 * record closed outside the configured reopen window, and the dialog turns
 * that into an explicit break-glass confirm rather than silently overriding.
 * That mirrors the CONFIRM_ELAPSED handling on the scheduling publish flow.
 */

interface Props {
  open: boolean
  entity: 'SUBMISSION' | 'DISPUTE'
  entityId: number
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface ApiError {
  response?: { data?: { message?: string; code?: string } }
}

export function UnlockDialog({ open, entity, entityId, onOpenChange, onSuccess }: Props) {
  const { options: reasonOptions } = useUnlockReasons()
  const [reasonCode, setReasonCode] = useState<string>('')
  const [note, setNote] = useState('')
  const [beyondWindowPrompt, setBeyondWindowPrompt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isDispute = entity === 'DISPUTE'

  const reset = () => {
    setReasonCode('')
    setNote('')
    setBeyondWindowPrompt(null)
    setError(null)
  }

  const mutation = useMutation({
    mutationFn: (confirmBeyondWindow: boolean) => {
      const payload = {
        reason_code: reasonCode,
        reason_note: note.trim(),
        confirm_beyond_window: confirmBeyondWindow,
      }
      return isDispute
        ? unlockService.unlockDispute(entityId, payload)
        : unlockService.unlockSubmission(entityId, payload)
    },
    onSuccess: () => {
      reset()
      onOpenChange(false)
      onSuccess()
    },
    onError: (err: ApiError) => {
      const data = err.response?.data
      if (data?.code === 'BEYOND_WINDOW') {
        setBeyondWindowPrompt(data.message ?? 'This record is outside the reopen window.')
        setError(null)
        return
      }
      setError(data?.message ?? 'Could not reopen this record. Try again.')
    },
  })

  const canSubmit = reasonCode !== '' && note.trim().length >= UNLOCK_MIN_NOTE && !mutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isDispute ? 'Reopen Dispute Decision' : 'Reopen Review'}</DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-[13px] text-slate-600">
          {isDispute
            ? 'This puts the dispute back in an open state so it can be edited and re-decided. The agent, the original reviewer, and the agent\u2019s manager are notified.'
            : 'This withdraws the score and returns the review to the reviewer as a draft. The agent, the reviewer, and the agent\u2019s manager are notified.'}{' '}
          Every reopen is recorded in the Unlock Register with your name and the reason below.
        </DialogDescription>

        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-slate-600">
            Reason <span className="text-red-500">*</span>
          </p>
          <Select value={reasonCode} onValueChange={setReasonCode}>
            <SelectTrigger className="text-[13px]">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {reasonOptions.map((opt) => (
                <SelectItem key={opt.code} value={opt.code} className="text-[13px]">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-slate-600">
            Justification <span className="text-red-500">*</span>
          </p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What exactly is wrong, and what will change? This is read by whoever reviews the register."
            rows={4}
            className="text-[13px]"
          />
          <p className="text-[11px] text-slate-400">
            {note.trim().length < UNLOCK_MIN_NOTE
              ? `${UNLOCK_MIN_NOTE - note.trim().length} more characters required`
              : `${note.trim().length} characters`}
          </p>
        </div>

        {beyondWindowPrompt && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-[12px] text-amber-800">{beyondWindowPrompt}</p>
              <p className="text-[12px] text-amber-800 font-medium">
                Reopen anyway? This is flagged as an out-of-window override in the register.
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className={
              beyondWindowPrompt
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-primary hover:bg-primary/90 text-white'
            }
            disabled={!canSubmit}
            onClick={() => mutation.mutate(!!beyondWindowPrompt)}
          >
            <Unlock className="h-3.5 w-3.5 mr-1.5" />
            {mutation.isPending ? 'Reopening\u2026' : beyondWindowPrompt ? 'Reopen anyway' : 'Reopen'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
