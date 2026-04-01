import { ExternalLink, Paperclip } from 'lucide-react'
import { formatQualityDate } from '@/utils/dateFormat'
import type { WriteUpDetail } from '@/services/writeupService'

// ── Layout primitives ─────────────────────────────────────────────────────────

function DetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-3 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 mt-4 border-t border-slate-100">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-[13px] text-slate-800 font-medium">{value ?? <span className="text-slate-400 font-normal">—</span>}</div>
    </div>
  )
}

function NoteBlock({ text, placeholder }: { text?: string | null; placeholder: string }) {
  return text
    ? <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{text}</p>
    : <p className="text-[13px] text-slate-400 italic">{placeholder}</p>
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  if (source === 'QA_IMPORT') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">QA</span>
  )
  if (source === 'COACHING_IMPORT') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700">Coaching</span>
  )
  return null
}

// ── Incidents display ─────────────────────────────────────────────────────────

function IncidentsDisplay({ writeup }: { writeup: WriteUpDetail }) {
  if (!writeup.incidents?.length) {
    return (
      <DetSection title="Incidents">
        <p className="text-[13px] text-slate-400 italic">No incidents recorded.</p>
      </DetSection>
    )
  }
  return (
    <DetSection title="Incidents">
      <div className="space-y-4">
        {writeup.incidents.map((inc, i) => (
          <div key={inc.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/30">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
                Incident {i + 1}
              </span>
              <span className="text-[12px] text-slate-500">{formatQualityDate(inc.incident_date)}</span>
            </div>
            <p className="text-[13px] text-slate-700 mb-3">{inc.description}</p>

            {inc.violations?.map((v, vi) => (
              <div key={v.id} className="border border-slate-200 rounded-lg p-3 mb-2 last:mb-0 bg-white">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[12px] font-semibold text-slate-700">{v.policy_violated}</span>
                  {v.reference_material && (
                    <span className="text-[11px] text-slate-400 shrink-0">{v.reference_material}</span>
                  )}
                </div>
                {(v.examples?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                      Examples ({v.examples.length})
                    </p>
                    {v.examples.map((ex, ei) => (
                      <div key={ex.id ?? ei} className="flex items-start gap-2 py-1.5 border-t border-slate-50">
                        <SourceBadge source={ex.source} />
                        {ex.example_date && (
                          <span className="text-[11px] text-slate-400 shrink-0 pt-0.5">
                            {formatQualityDate(ex.example_date)}
                          </span>
                        )}
                        <p className="text-[12px] text-slate-600 flex-1">{ex.description}</p>
                        {ex.source === 'QA_IMPORT' && ex.qa_submission_id && (
                          <a
                            href={`/app/quality/submissions/${ex.qa_submission_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-primary hover:text-primary/70 transition-colors pt-0.5"
                            title="View completed QA form"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {(v.examples?.length ?? 0) === 0 && vi === 0 && (
                  <p className="text-[12px] text-slate-400 italic mt-1">No examples added</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </DetSection>
  )
}

// ── Corrective action display ─────────────────────────────────────────────────

function CorrectiveDisplay({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <DetSection title="Corrective Action & Expectations">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <div className="col-span-2">
          <InfoRow label="Required Corrective Action"
            value={<NoteBlock text={writeup.corrective_action} placeholder="Not specified" />} />
        </div>
        <InfoRow label="Timeline for Correction" value={writeup.correction_timeline} />
        <InfoRow label="30-Day Check-In Date"
          value={writeup.checkin_date ? formatQualityDate(writeup.checkin_date) : null} />
        {writeup.consequence && (
          <div className="col-span-2">
            <InfoRow label="Consequence if Not Met"
              value={<NoteBlock text={writeup.consequence} placeholder="" />} />
          </div>
        )}
      </div>
      {writeup.linked_coaching_id && (
        <Sub title="Linked Coaching Session">
          <a href={`/app/training/coaching/${writeup.linked_coaching_id}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors">
            <span className="text-[13px] text-primary font-medium">
              Coaching Session #{writeup.linked_coaching_id}
            </span>
            <ExternalLink className="h-3.5 w-3.5 text-primary" />
          </a>
        </Sub>
      )}
    </DetSection>
  )
}

// ── Prior discipline display ───────────────────────────────────────────────────

function PriorDisciplineDisplay({ writeup }: { writeup: WriteUpDetail }) {
  if (!writeup.prior_discipline?.length) return null
  return (
    <DetSection title="Prior Discipline & Coaching History">
      <div className="space-y-2">
        {writeup.prior_discipline.map((pd: any, i: number) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
            <span className="text-[12px] font-medium text-slate-700 flex-1">
              {pd.reference_type === 'write_up' ? 'Write-Up' : 'Coaching'} #{pd.reference_id}
            </span>
            <a
              href={pd.reference_type === 'write_up'
                ? `/app/writeups/${pd.reference_id}`
                : `/app/training/coaching/${pd.reference_id}`}
              target="_blank" rel="noreferrer"
              className="text-slate-400 hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>
    </DetSection>
  )
}

// ── Attachments display ───────────────────────────────────────────────────────

function AttachmentsDisplay({ writeup }: { writeup: WriteUpDetail }) {
  if (!writeup.attachments?.length) return null
  return (
    <DetSection title="Attachments">
      <div className="space-y-2">
        {writeup.attachments.map(a => (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <Paperclip className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="flex-1 text-[13px] text-slate-700 truncate">{a.filename}</span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-slate-200 text-slate-600 shrink-0">
              {a.attachment_type}
            </span>
            {a.file_size && (
              <span className="text-[11px] text-slate-400 shrink-0">
                {(a.file_size / 1024).toFixed(0)} KB
              </span>
            )}
          </div>
        ))}
      </div>
    </DetSection>
  )
}

// ── Meeting notes display ─────────────────────────────────────────────────────

function MeetingNotesDisplay({ writeup }: { writeup: WriteUpDetail }) {
  const showStatuses = ['DELIVERED', 'AWAITING_SIGNATURE', 'SIGNED', 'FOLLOW_UP_PENDING', 'CLOSED']
  if (!showStatuses.includes(writeup.status)) return null
  return (
    <DetSection title="Meeting Notes">
      <NoteBlock text={writeup.meeting_notes} placeholder="No meeting notes recorded." />
    </DetSection>
  )
}

// ── Follow-up display ─────────────────────────────────────────────────────────

function FollowUpDisplay({ writeup }: { writeup: WriteUpDetail }) {
  const show = writeup.status === 'FOLLOW_UP_PENDING' ||
    (writeup.status === 'CLOSED' && writeup.follow_up_required)
  if (!show) return null
  return (
    <DetSection title="Follow-Up">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <InfoRow label="Follow-Up Date"
          value={writeup.follow_up_date ? formatQualityDate(writeup.follow_up_date) : null} />
        <InfoRow label="Assigned To" value={writeup.follow_up_assignee_name ?? null} />
        {writeup.follow_up_checklist && (
          <div className="col-span-2">
            <InfoRow label="Checklist"
              value={<NoteBlock text={writeup.follow_up_checklist} placeholder="" />} />
          </div>
        )}
        {writeup.follow_up_notes && (
          <div className="col-span-2 border-t border-slate-100 pt-4">
            <InfoRow label="Follow-Up Notes"
              value={<NoteBlock text={writeup.follow_up_notes} placeholder="" />} />
          </div>
        )}
      </div>
    </DetSection>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ContentSections({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <>
      <IncidentsDisplay writeup={writeup} />
      <CorrectiveDisplay writeup={writeup} />
      <PriorDisciplineDisplay writeup={writeup} />
      <AttachmentsDisplay writeup={writeup} />
      <MeetingNotesDisplay writeup={writeup} />
      <FollowUpDisplay writeup={writeup} />
    </>
  )
}
