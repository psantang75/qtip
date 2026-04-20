import React, { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import qaService from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Section, SectionLabel } from '@/components/common/DetailLayout'
import { useToast } from '@/hooks/use-toast'

// ── Agent submit new dispute ─────────────────────────────────────────────────
export function DisputeForm({ submissionId, onSuccess }: { submissionId: number; onSuccess: () => void }) {
  const [reason, setReason] = useState('')
  const { toast } = useToast()
  const qc = useQueryClient()

  const { mutate, isPending } = useMutation({
    mutationFn: () => qaService.submitCSRDispute({ submission_id: submissionId, reason }),
    onSuccess: () => {
      toast({ title: 'Dispute submitted', description: 'Sent to your manager for review.' })
      qc.invalidateQueries({ queryKey: ['submission-detail'] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
      qc.invalidateQueries({ queryKey: ['agent-dispute-history'] })
      onSuccess()
    },
    onError: () => toast({ title: 'Error', description: 'Failed to submit dispute.', variant: 'destructive' }),
  })

  const minLen = 10
  return (
    <Section title="Dispute" badge={<AlertTriangle className="h-4 w-4 text-slate-500 shrink-0" />}>
      <div className="space-y-3">
        <RichTextEditor value={reason} onChange={setReason}
          placeholder="Explain why you believe this score is incorrect…"
          className="text-[13px]" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {reason.trim().length < minLen ? `${minLen - reason.trim().length} more characters needed` : ''}
          </span>
          <Button size="sm" onClick={() => mutate()} disabled={isPending || reason.trim().length < minLen}
            className="bg-primary hover:bg-primary/90 text-white">
            {isPending ? 'Submitting…' : 'Submit Dispute'}
          </Button>
        </div>
      </div>
    </Section>
  )
}

// ── Agent edit open dispute ──────────────────────────────────────────────────
export function EditDisputeForm({
  dispute,
  onSuccess,
  onCancel,
}: {
  dispute: { id: number; reason: string; attachment_url?: string | null }
  onSuccess: () => void
  onCancel: () => void
}) {
  const [reason, setReason]       = useState(dispute.reason)
  const [file, setFile]           = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => qaService.updateCSRDispute(dispute.id, reason, file),
    onSuccess: () => {
      toast({ title: 'Dispute updated' })
      qc.invalidateQueries({ queryKey: ['submission-detail'] })
      qc.invalidateQueries({ queryKey: ['agent-dispute-history'] })
      onSuccess()
    },
    onError: (err: any) =>
      toast({ title: 'Error', description: err?.response?.data?.message ?? 'Failed to update dispute.', variant: 'destructive' }),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null)
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setFileError('File must be under 5 MB'); return }
    const allowed = ['application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/jpg', 'image/png']
    if (!allowed.includes(f.type)) { setFileError('Only PDF, DOC, DOCX, JPG, PNG allowed'); return }
    setFile(f)
  }

  return (
    <div className="space-y-3 border border-primary/30 bg-primary/5 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-semibold text-slate-800">Edit Dispute</h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>
      <div>
        <RichTextEditor value={reason} onChange={setReason}
          className="text-[13px] bg-white" />
      </div>
      <div>
        <SectionLabel>Supporting Evidence (optional)</SectionLabel>
        <input type="file" onChange={handleFileChange}
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          className="text-[12px] w-full text-slate-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-[12px] file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
        {dispute.attachment_url && !file && (
          <p className="text-[11px] text-slate-400 mt-1">Current: {dispute.attachment_url.split('/').pop()}</p>
        )}
        {file && <p className="text-[11px] text-primary mt-1">New file: {file.name}</p>}
        {fileError && <p className="text-[11px] text-red-600 mt-1">{fileError}</p>}
      </div>
      {error && (
        <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {(error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update dispute.'}
        </p>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>Cancel</Button>
        <Button size="sm" onClick={() => mutate()} disabled={isPending || !reason.trim()}
          className="bg-primary hover:bg-primary/90 text-white">
          {isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}
