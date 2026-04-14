import { Download, Paperclip } from 'lucide-react'
import { formatQualityDate } from '@/utils/dateFormat'
import type { WriteUpDetail } from '@/services/writeupService'
import {
  WRITE_UP_TYPE_LABELS as TYPE_LABELS,
  WRITE_UP_STATUS_LABELS as STATUS_LABELS,
} from '@/constants/labels'
import { Section, Sub, InfoRow, NoteBlock } from './layout'
import { IncidentsSection } from './IncidentsSection'
import { CorrectiveSection } from './CorrectiveSection'
import { PriorDisciplineSection } from './PriorDisciplineSection'

// ── 1. Overview ───────────────────────────────────────────────────────────────

function OverviewSection({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <Section title="Write-Up Details">
      <div className="grid grid-cols-3 gap-x-8 gap-y-4">
        <InfoRow label="Employee"      value={writeup.csr_name} />
        <InfoRow label="Document Type" value={TYPE_LABELS[writeup.document_type] ?? writeup.document_type} />
        <InfoRow label="Status"        value={STATUS_LABELS[writeup.status] ?? writeup.status} />
        <InfoRow label="Manager"       value={writeup.manager_name ?? null} />
        <InfoRow label="HR Witness"    value={writeup.hr_witness_name ?? null} />
        <InfoRow label="Meeting Date"  value={writeup.meeting_date ? formatQualityDate(writeup.meeting_date) : null} />
        <InfoRow label="Created By"    value={writeup.created_by_name} />
        <InfoRow label="Created"       value={formatQualityDate(writeup.created_at)} />
      </div>
    </Section>
  )
}

// ── 5. Attachments ────────────────────────────────────────────────────────────

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
            <a href={`/api/writeups/${writeup.id}/attachments/${a.id}`} target="_blank" rel="noopener noreferrer"
              className="text-primary hover:text-primary/80 shrink-0" title="View / Download">
              <Download className="h-4 w-4" />
            </a>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── 6. Meeting Notes ──────────────────────────────────────────────────────────

function MeetingNotesSection({ writeup }: { writeup: WriteUpDetail }) {
  const showStatuses = ['AWAITING_SIGNATURE', 'SIGNED', 'FOLLOW_UP_PENDING', 'CLOSED']
  if (!showStatuses.includes(writeup.status)) return null
  return (
    <Section title="Meeting Notes">
      <NoteBlock text={writeup.meeting_notes} placeholder="No meeting notes recorded." />
    </Section>
  )
}

// ── 7. Follow-Up ──────────────────────────────────────────────────────────────

function FollowUpSection({ writeup }: { writeup: WriteUpDetail }) {
  const show = writeup.status === 'FOLLOW_UP_PENDING' || (writeup.status === 'CLOSED' && writeup.follow_up_required)
  if (!show) return null
  return (
    <Section title="Follow-Up">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <InfoRow label="Follow-Up Date" value={writeup.follow_up_date ? formatQualityDate(writeup.follow_up_date) : null} />
        <InfoRow label="Assigned To" value={writeup.follow_up_assignee_name ?? null} />
      </div>
      {writeup.follow_up_checklist && <Sub title="Checklist"><NoteBlock text={writeup.follow_up_checklist} placeholder="" /></Sub>}
      {writeup.follow_up_notes && <Sub title="Follow-Up Notes"><NoteBlock text={writeup.follow_up_notes} placeholder="" /></Sub>}
    </Section>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ContentSections({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <>
      <OverviewSection        writeup={writeup} />
      <IncidentsSection       writeup={writeup} />
      <CorrectiveSection      writeup={writeup} />
      <PriorDisciplineSection writeup={writeup} />
      <AttachmentsSection     writeup={writeup} />
      <MeetingNotesSection    writeup={writeup} />
      <FollowUpSection        writeup={writeup} />
    </>
  )
}
