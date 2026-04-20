import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { formatQualityDate } from '@/utils/dateFormat'
import writeupService from '@/services/writeupService'
import type { WriteUpDetail } from '@/services/writeupService'
import {
  WRITE_UP_TYPE_LABELS as TYPE_LABELS,
  WRITE_UP_STATUS_LABELS as STATUS_LABELS,
} from '@/constants/labels'
import { Section, Sub, InfoRow, NoteBlock } from './layout'
import { IncidentsSection } from './IncidentsSection'
import { CorrectiveSection } from './CorrectiveSection'
import { PriorDisciplineSection } from './PriorDisciplineSection'
import { InternalNotesPanel } from '@/components/common/InternalNotesPanel'
import { InternalNotesSection } from '../writeup-form/InternalNotesSection'
import { ActionCard } from './ActionCard'
import listService from '@/services/listService'
import { useToast } from '@/hooks/use-toast'

// ── 1. Overview ───────────────────────────────────────────────────────────────

function OverviewSection({ writeup, isAgentView }: { writeup: WriteUpDetail; isAgentView?: boolean }) {
  return (
    <Section title="Performance Warning Details">
      <div className="grid grid-cols-3 gap-x-8 gap-y-4">
        <InfoRow label="Employee"      value={writeup.csr_name} />
        <InfoRow label="Document Type" value={TYPE_LABELS[writeup.document_type] ?? writeup.document_type} />
        <InfoRow label="Status"        value={STATUS_LABELS[writeup.status] ?? writeup.status} />
        <InfoRow label="Manager"       value={writeup.manager_name ?? null} />
        <InfoRow label="HR Witness"    value={writeup.hr_witness_name ?? null} />
        <InfoRow label="Meeting Date"  value={writeup.meeting_date ? formatQualityDate(writeup.meeting_date) : null} />
        {!isAgentView && <InfoRow label="Created By" value={writeup.created_by_name} />}
        {!isAgentView && <InfoRow label="Created" value={formatQualityDate(writeup.created_at)} />}
      </div>
    </Section>
  )
}

// ── 5. Attachments ────────────────────────────────────────────────────────────

async function openAttachment(writeUpId: number, attachmentId: number, filename: string) {
  const blob = await writeupService.downloadAttachment(writeUpId, attachmentId)
  const url = URL.createObjectURL(blob)
  const isViewable = /\.(jpe?g|png|gif|pdf)$/i.test(filename)
  if (isViewable) {
    window.open(url, '_blank')
  } else {
    const a = Object.assign(document.createElement('a'), { href: url, download: filename })
    a.click()
    URL.revokeObjectURL(url)
  }
}

function AttachmentsSection({ writeup }: { writeup: WriteUpDetail }) {
  if (!writeup.attachments?.length) return null
  return (
    <Section title="Attachments">
      <div className="space-y-2">
        {writeup.attachments.map(a => (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <Paperclip className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="flex-1 text-[13px] text-slate-700 truncate">{a.filename}</span>
            {a.file_size && <span className="text-[11px] text-slate-400 shrink-0">{(a.file_size / 1024).toFixed(0)} KB</span>}
            <button onClick={() => openAttachment(writeup.id, a.id, a.filename)}
              className="text-primary hover:text-primary/80 shrink-0" title="View / Download">
              <Download className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── 6. Meeting Notes ──────────────────────────────────────────────────────────

function MeetingNotesSection({ writeup }: { writeup: WriteUpDetail }) {
  const showStatuses = ['AWAITING_SIGNATURE', 'SIGNED', 'SIGNATURE_REFUSED', 'FOLLOW_UP_PENDING', 'FOLLOW_UP_COMPLETED', 'CLOSED']
  if (!showStatuses.includes(writeup.status)) return null
  return (
    <Section title="Meeting Notes">
      <NoteBlock text={writeup.meeting_notes} placeholder="No meeting notes recorded." bold />
    </Section>
  )
}

// ── 7. Follow-Up Section (both views) ─────────────────────────────────────────

/**
 * Follow-Up section visible to both management and the agent once a write-up
 * reaches FOLLOW_UP_PENDING. Management sees an inline editor + "Save
 * Follow-Up Notes" button. Agent sees a read-only view of the follow-up
 * details (date, assignee, checklist) and the notes once they are saved.
 *
 * Lives ABOVE Internal Notes so the follow-up step is completed before the
 * warning is closed from the Internal Notes section.
 */
function FollowUpEditableSection({
  writeup, isAgentView, id, onInvalidate,
}: {
  writeup: WriteUpDetail
  isAgentView?: boolean
  id?: number
  onInvalidate?: () => void
}) {
  // Agents can see Follow-Up details as soon as they exist (they were
  // discussed in the meeting). Managers only need it once we hit the
  // post-signing follow-up workflow.
  const hasFollowUpDetails = !!(
    writeup.follow_up_date ||
    writeup.follow_up_assignee_name ||
    writeup.follow_up_checklist
  )
  const managerVisible =
    writeup.status === 'FOLLOW_UP_PENDING' ||
    writeup.status === 'FOLLOW_UP_COMPLETED' ||
    writeup.status === 'CLOSED'
  const agentVisible = hasFollowUpDetails && (
    writeup.status === 'AWAITING_SIGNATURE' ||
    writeup.status === 'SIGNED' ||
    writeup.status === 'SIGNATURE_REFUSED' ||
    writeup.status === 'FOLLOW_UP_PENDING' ||
    writeup.status === 'FOLLOW_UP_COMPLETED' ||
    writeup.status === 'CLOSED'
  )
  const visible = writeup.follow_up_required &&
    (isAgentView ? agentVisible : managerVisible)

  const { toast } = useToast()
  const qc        = useQueryClient()

  const canEdit = !isAgentView
    && writeup.status === 'FOLLOW_UP_PENDING'
    && id !== undefined
    && !!onInvalidate

  const [notes, setNotes] = useState(writeup.follow_up_notes ?? '')

  useEffect(() => {
    setNotes(writeup.follow_up_notes ?? '')
  }, [writeup.follow_up_notes, writeup.status])

  const saveNotesMut = useMutation({
    mutationFn: () => writeupService.updateFollowUpNotes(id!, {
      follow_up_notes: notes.trim() ? notes : null,
    }),
    onSuccess: () => {
      toast({ title: 'Follow-up notes saved' })
      onInvalidate?.()
      qc.invalidateQueries({ queryKey: ['writeups'] })
      qc.invalidateQueries({ queryKey: ['my-writeups'] })
    },
    onError: (err: Error) => toast({ title: 'Save failed', description: err?.message, variant: 'destructive' }),
  })

  const completeMut = useMutation({
    mutationFn: async () => {
      await writeupService.updateFollowUpNotes(id!, {
        follow_up_notes: notes.trim() ? notes : null,
      })
      await writeupService.transitionStatus(id!, { status: 'FOLLOW_UP_COMPLETED' })
    },
    onSuccess: () => {
      toast({ title: 'Follow-up marked complete' })
      onInvalidate?.()
      qc.invalidateQueries({ queryKey: ['writeups'] })
      qc.invalidateQueries({ queryKey: ['my-writeups'] })
    },
    onError: (err: Error) => toast({ title: 'Update failed', description: err?.message, variant: 'destructive' }),
  })

  if (!visible) return null

  const busy = saveNotesMut.isPending || completeMut.isPending

  return (
    <Section title="Follow-Up">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <InfoRow label="Follow-Up Date" value={writeup.follow_up_date ? formatQualityDate(writeup.follow_up_date) : null} />
        <InfoRow label="Meeting With"   value={writeup.follow_up_assignee_name ?? null} />
        {writeup.follow_up_completed_at && (
          <InfoRow label="Follow-Up Completed" value={formatQualityDate(writeup.follow_up_completed_at)} />
        )}
      </div>
      {writeup.follow_up_checklist && (
        <Sub title="Follow Up Focus"><NoteBlock text={writeup.follow_up_checklist} placeholder="" bold /></Sub>
      )}

      {canEdit ? (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Follow-Up Notes</p>
          <RichTextEditor
            value={notes}
            placeholder="Document what happened at the follow-up check-in…"
            onChange={setNotes}
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-[12px] text-slate-500 italic">
              Save your notes, then mark the follow-up complete to move on to closing the warning.
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveNotesMut.mutate()}
                disabled={busy || !notes.trim() || notes === (writeup.follow_up_notes ?? '')}
              >
                {saveNotesMut.isPending ? 'Saving…' : 'Save Notes'}
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-white"
                onClick={() => completeMut.mutate()}
                disabled={busy || !notes.trim()}
              >
                {completeMut.isPending ? 'Completing…' : 'Mark Follow-Up Complete'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        writeup.follow_up_notes && (
          <Sub title="Follow-Up Notes"><NoteBlock text={writeup.follow_up_notes} placeholder="" bold /></Sub>
        )
      )}
    </Section>
  )
}

// ── 8. Internal Notes (management only) ──────────────────────────────────────

interface InternalDraft {
  internal_notes: string
  behavior_flag_ids: number[]
  root_cause_ids: number[]
  support_needed_ids: number[]
}

/**
 * Management-only Internal Notes section. Auto-opens in edit mode at SIGNED
 * and FOLLOW_UP_PENDING so managers record their internal assessment before
 * closing the performance warning, with a red "Save & Close Performance
 * Warning" button at the bottom. At FOLLOW_UP_PENDING, the follow-up notes
 * must be saved first (from the Follow-Up section above) before the warning
 * can be closed.
 */
function InternalNotesEditableSection({
  writeup, isAgentView, id, onInvalidate,
}: {
  writeup: WriteUpDetail
  isAgentView?: boolean
  id?: number
  onInvalidate?: () => void
}) {
  if (isAgentView) return null

  const { toast } = useToast()
  const qc        = useQueryClient()

  const atCloseoutStatus =
    writeup.status === 'SIGNED' ||
    writeup.status === 'SIGNATURE_REFUSED' ||
    writeup.status === 'FOLLOW_UP_COMPLETED'
  const canEdit  = id !== undefined && onInvalidate && writeup.status !== 'CLOSED'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState<InternalDraft>({
    internal_notes:     writeup.internal_notes ?? '',
    behavior_flag_ids:  writeup.behavior_flag_ids ?? [],
    root_cause_ids:     writeup.root_cause_ids ?? [],
    support_needed_ids: writeup.support_needed_ids ?? [],
  })

  useEffect(() => {
    if (!canEdit) { setEditing(false); return }
    if (atCloseoutStatus) {
      setDraft({
        internal_notes:     writeup.internal_notes ?? '',
        behavior_flag_ids:  writeup.behavior_flag_ids ?? [],
        root_cause_ids:     writeup.root_cause_ids ?? [],
        support_needed_ids: writeup.support_needed_ids ?? [],
      })
      setEditing(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeup.status, canEdit])

  const { data: flagItems          = [] } = useQuery({ queryKey: ['list-items', 'behavior_flag'],  queryFn: () => listService.getItems('behavior_flag'),  enabled: editing })
  const { data: rootCauseItems     = [] } = useQuery({ queryKey: ['list-items', 'root_cause'],     queryFn: () => listService.getItems('root_cause'),     enabled: editing })
  const { data: supportNeededItems = [] } = useQuery({ queryKey: ['list-items', 'support_needed'], queryFn: () => listService.getItems('support_needed'), enabled: editing })

  const persistInternal = () => writeupService.updateInternalNotes(id!, {
    internal_notes:     draft.internal_notes || null,
    behavior_flag_ids:  draft.behavior_flag_ids,
    root_cause_ids:     draft.root_cause_ids,
    support_needed_ids: draft.support_needed_ids,
  })

  const saveMut = useMutation({
    mutationFn: persistInternal,
    onSuccess: () => {
      toast({ title: 'Internal notes saved' })
      if (!atCloseoutStatus) setEditing(false)
      onInvalidate?.()
      qc.invalidateQueries({ queryKey: ['writeups'] })
    },
    onError: (err: Error) => toast({ title: 'Save failed', description: err?.message, variant: 'destructive' }),
  })

  const saveAndCloseMut = useMutation({
    mutationFn: async () => {
      await persistInternal()
      await writeupService.transitionStatus(id!, { status: 'CLOSED' })
    },
    onSuccess: () => {
      toast({ title: 'Performance Warning closed' })
      onInvalidate?.()
      qc.invalidateQueries({ queryKey: ['writeups'] })
      qc.invalidateQueries({ queryKey: ['my-writeups'] })
    },
    onError: (err: Error) => toast({ title: 'Close failed', description: err?.message, variant: 'destructive' }),
  })

  const busy = saveMut.isPending || saveAndCloseMut.isPending

  const startEdit = () => {
    setDraft({
      internal_notes:     writeup.internal_notes ?? '',
      behavior_flag_ids:  writeup.behavior_flag_ids ?? [],
      root_cause_ids:     writeup.root_cause_ids ?? [],
      support_needed_ids: writeup.support_needed_ids ?? [],
    })
    setEditing(true)
  }

  if (editing) {
    const update = (k: keyof InternalDraft, v: any) => setDraft(d => ({ ...d, [k]: v }))

    // FOLLOW_UP_COMPLETED is reached only after follow-up notes are saved
    // via the Follow-Up section, so no extra gate is needed here.
    const canSaveAndClose = atCloseoutStatus

    return (
      <div className="space-y-2">
        <InternalNotesSection
          form={draft as any}
          flagItems={flagItems}
          rootCauseItems={rootCauseItems}
          supportNeededItems={supportNeededItems}
          update={update as any}
        />

        <div className="bg-white rounded-xl border border-slate-200 p-3 mt-2">
          <div className="flex items-center justify-between">
            {atCloseoutStatus ? (
              <span className="text-[12px] text-slate-500 italic">
                Record internal notes before closing.
              </span>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white"
                onClick={() => saveMut.mutate()} disabled={busy}>
                {saveMut.isPending ? 'Saving…' : 'Save'}
              </Button>
              {atCloseoutStatus && (
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => saveAndCloseMut.mutate()} disabled={busy || !canSaveAndClose}>
                  {saveAndCloseMut.isPending ? 'Closing…' : 'Save & Close Performance Warning'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <InternalNotesPanel
      internalNotes={writeup.internal_notes}
      behaviorFlagItems={writeup.behavior_flag_items}
      rootCauseItems={writeup.root_cause_items}
      supportNeededItems={writeup.support_needed_items}
      canEdit={canEdit}
      onEdit={startEdit}
    />
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface ContentSectionsProps {
  writeup: WriteUpDetail
  isAgentView?: boolean
  id?: number
  onInvalidate?: () => void
}

export function ContentSections({ writeup, isAgentView, id, onInvalidate }: ContentSectionsProps) {
  const showActionCard = !isAgentView && id !== undefined && onInvalidate
  return (
    <>
      <OverviewSection                writeup={writeup} isAgentView={isAgentView} />
      <IncidentsSection               writeup={writeup} />
      <CorrectiveSection              writeup={writeup} />
      <PriorDisciplineSection         writeup={writeup} />
      <AttachmentsSection             writeup={writeup} />
      <MeetingNotesSection            writeup={writeup} />
      {showActionCard && (
        <ActionCard writeup={writeup} id={id!} onInvalidate={onInvalidate!} />
      )}
      <FollowUpEditableSection        writeup={writeup} isAgentView={isAgentView} id={id} onInvalidate={onInvalidate} />
      <InternalNotesEditableSection   writeup={writeup} isAgentView={isAgentView} id={id} onInvalidate={onInvalidate} />
    </>
  )
}
