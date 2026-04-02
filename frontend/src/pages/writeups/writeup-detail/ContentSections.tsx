import { Download, ExternalLink, Paperclip } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatQualityDate } from '@/utils/dateFormat'
import type { WriteUpDetail } from '@/services/writeupService'

// ── Label maps ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  VERBAL_WARNING: 'Verbal Warning', WRITTEN_WARNING: 'Written Warning', FINAL_WARNING: 'Final Warning',
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', DELIVERED: 'Delivered',
  AWAITING_SIGNATURE: 'Awaiting Signature', SIGNED: 'Signed',
  FOLLOW_UP_PENDING: 'Follow-Up Pending', CLOSED: 'Closed',
}

const COACHING_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled', IN_PROCESS: 'In Process', IN_PROGRESS: 'In Progress',
  AWAITING_CSR_ACTION: 'Awaiting CSR', COMPLETED: 'Completed',
  FOLLOW_UP_REQUIRED: 'Follow-Up', CLOSED: 'Closed',
}

const PURPOSE_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly', PERFORMANCE: 'Performance', ONBOARDING: 'Onboarding',
}

// ── Layout primitives — mirrors Training Detail exactly ───────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="border-b border-slate-100 pb-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
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
      <div className="text-[13px] text-slate-800 font-medium">
        {value ?? <span className="text-slate-400 font-normal">—</span>}
      </div>
    </div>
  )
}

function NoteBlock({ text, placeholder }: { text?: string | null; placeholder: string }) {
  return text
    ? <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{text}</p>
    : <p className="text-[13px] text-slate-400 italic">{placeholder}</p>
}

// ── 1. Overview ───────────────────────────────────────────────────────────────

function OverviewSection({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <Section title="Write-Up Details">
      <div className="grid grid-cols-3 gap-x-8 gap-y-4">
        {/* Row 1: Employee · Document Type · Status */}
        <InfoRow label="Employee"      value={writeup.csr_name} />
        <InfoRow label="Document Type" value={TYPE_LABELS[writeup.document_type] ?? writeup.document_type} />
        <InfoRow label="Status"        value={STATUS_LABELS[writeup.status] ?? writeup.status} />

        {/* Row 2: Manager · HR Witness · Meeting Date */}
        <InfoRow label="Manager"       value={writeup.manager_name ?? null} />
        <InfoRow label="HR Witness"    value={writeup.hr_witness_name ?? null} />
        <InfoRow label="Meeting Date"  value={writeup.meeting_date ? formatQualityDate(writeup.meeting_date) : null} />

        {/* Row 3: Created By · Created Date */}
        <InfoRow label="Created By"    value={writeup.created_by_name} />
        <InfoRow label="Created"       value={formatQualityDate(writeup.created_at)} />
      </div>
    </Section>
  )
}

// ── 2. Incidents ──────────────────────────────────────────────────────────────

function IncidentsSection({ writeup }: { writeup: WriteUpDetail }) {
  if (!writeup.incidents?.length) {
    return (
      <Section title="Incidents">
        <p className="text-[13px] text-slate-400 italic">No incidents recorded.</p>
      </Section>
    )
  }

  return (
    <Section title="Incidents">
      <div className="space-y-5">
        {writeup.incidents.map((inc, i) => (
          <div key={inc.id} className="border border-slate-200 rounded-xl overflow-hidden">

            {/* Incident header */}
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                Incident #{i + 1}
              </span>
            </div>

            {/* Incident description */}
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Description</p>
              <p className="text-[13px] text-slate-700 leading-relaxed">{inc.description}</p>
            </div>

            {/* Violations */}
            {inc.violations?.map((v, vi) => (
              <div key={v.id} className="border-t border-slate-200">

                {/* Policy violated + reference material */}
                <div className="px-4 py-3 bg-white">
                  <div className="grid grid-cols-3 gap-x-8">
                    <InfoRow label="Policy Violated" value={<span className="font-medium text-slate-800">{v.policy_violated}</span>} />
                    <InfoRow label="Reference Material" value={v.reference_material ?? null} />
                  </div>

                  {/* Examples */}
                  {(v.examples?.length ?? 0) > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                        Examples
                      </p>
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[90px]">Type</th>
                              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[100px]">Date</th>
                              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                              <th className="px-3 py-2 w-[36px]" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {v.examples.map((ex, ei) => (
                                <tr key={ex.id ?? ei} className="hover:bg-slate-50/60">
                                  <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
                                    {ex.source === 'QA_IMPORT' ? 'QA' : ex.source === 'COACHING_IMPORT' ? 'Coaching' : 'Manual'}
                                  </td>
                                  <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                                    {ex.example_date ? formatQualityDate(ex.example_date) : <span className="text-slate-300">&mdash;</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-slate-600 leading-relaxed">
                                    {ex.description}
                                  </td>
                                  <td className="px-3 py-2.5 text-center">
                                    {ex.source === 'QA_IMPORT' && ex.qa_submission_id && (
                                      <a
                                        href={`/app/quality/submissions/${ex.qa_submission_id}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="text-slate-400 hover:text-primary transition-colors"
                                        title="View completed QA form"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      </a>
                                    )}
                                  </td>
                                </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── 3. Corrective Action & Expectations ───────────────────────────────────────

function CorrectiveSection({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <Section title="Corrective Action & Expectations">
      {/* Required corrective action */}
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
        Required Corrective Action
      </p>
      <NoteBlock text={writeup.corrective_action} placeholder="Not specified" />

      {/* Timeline + check-in + consequence */}
      <div className="grid grid-cols-3 gap-x-8 gap-y-4 mt-4 pt-4 border-t border-slate-100">
        <InfoRow label="Timeline for Correction" value={writeup.correction_timeline ?? null} />
        <InfoRow label="Follow-Up Meeting Date"
          value={writeup.checkin_date ? formatQualityDate(writeup.checkin_date) : null} />
        <InfoRow label="Consequence if Not Met" value={writeup.consequence ?? null} />
      </div>

      {/* Linked coaching session */}
      {writeup.linked_coaching_id && (
        <Sub title="Linked Coaching Session">
          <div className="rounded-lg border border-slate-200 overflow-hidden -mx-1">
            <table className="w-full text-[13px] table-fixed">
              <colgroup>
                <col className="w-[150px]" />
                <col className="w-[110px]" />
                <col className="w-[160px]" />
                <col className="w-[160px]" />
                <col className="w-[130px]" />
                <col className="w-[44px]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Purpose / Type</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Topic</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const cs = writeup.linked_coaching_session
                  const topics = cs?.topic_names ?? []
                  const statusLabel = COACHING_STATUS_LABELS[cs?.status ?? ''] ?? cs?.status
                  const purposeLabel = PURPOSE_LABELS[cs?.coaching_purpose ?? ''] ?? cs?.coaching_purpose
                  return (
                    <tr className="hover:bg-slate-50/60">
                      <td className="px-3 py-2.5 text-slate-600 truncate">
                        {purposeLabel ?? <span className="text-slate-300">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {statusLabel ?? <span className="text-slate-300">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {topics.length > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[13px] text-slate-500 truncate block cursor-default">
                                {topics.join(', ')}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                              <ul className="space-y-1">
                                {topics.map((t, i) => (
                                  <li key={i} className="flex items-center gap-2 text-[13px] text-slate-700">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
                                  </li>
                                ))}
                              </ul>
                            </TooltipContent>
                          </Tooltip>
                        ) : <span className="text-slate-300">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {cs?.notes ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[13px] text-slate-500 truncate block cursor-default">
                                {cs.notes}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                              <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{cs.notes}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : <span className="text-slate-300">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                        {cs?.date ? formatQualityDate(String(cs.date).slice(0, 10)) : <span className="text-slate-300">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <a href={`/app/training/coaching/${writeup.linked_coaching_id}`} target="_blank" rel="noreferrer"
                          className="text-slate-400 hover:text-primary transition-colors">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </Sub>
      )}
    </Section>
  )
}

// ── 4. Prior Discipline & Coaching History ────────────────────────────────────

function PriorDisciplineSection({ writeup }: { writeup: WriteUpDetail }) {
  const items = writeup.prior_discipline ?? []
  if (!items.length) return null

  const splitSep = (val: string | string[] | null | undefined): string[] => {
    if (Array.isArray(val)) return val.filter(Boolean)
    if (!val) return []
    return String(val).split('~|~').filter(Boolean)
  }

  return (
    <Section title="Prior Discipline & Coaching History">
      <div className="rounded-lg border border-slate-200 overflow-hidden -mx-1">
        <table className="w-full text-[13px] table-fixed">
          <colgroup>
            <col className="w-[90px]" />
            <col className="w-[150px]" />
            <col className="w-[110px]" />
            <col className="w-[160px]" />
            <col className="w-[160px]" />
            <col className="w-[130px]" />
            <col className="w-[44px]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Type</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Purpose / Type</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Topic / Policy</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes / Incidents</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((pd: any, i: number) => {
              const isWriteUp = pd.reference_type === 'write_up'
              const detail  = splitSep(isWriteUp ? pd.policies_violated  : pd.topic_names)
              const notesTxt = isWriteUp
                ? splitSep(pd.incident_descriptions).join(' | ')
                : pd.notes
              const statusLabel = isWriteUp
                ? (STATUS_LABELS[pd.status] ?? pd.status)
                : (COACHING_STATUS_LABELS[pd.status] ?? pd.status)
              const subtypeLabel = isWriteUp
                ? (TYPE_LABELS[pd.document_type] ?? pd.document_type)
                : (PURPOSE_LABELS[pd.coaching_purpose] ?? pd.coaching_purpose)
              const date = pd.date
                ? String(pd.date).slice(0, 10)
                : undefined
              const href = isWriteUp
                ? `/app/writeups/${pd.reference_id}`
                : `/app/training/coaching/${pd.reference_id}`

              return (
                <tr key={i} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
                    {isWriteUp ? 'Write-Up' : 'Coaching'}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">
                    {subtypeLabel ?? <span className="text-slate-300">&mdash;</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-slate-600">
                    {statusLabel ?? <span className="text-slate-300">&mdash;</span>}
                  </td>

                  {/* Topic / Policy — tooltip bullet list */}
                  <td className="px-3 py-2.5">
                    {detail.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[13px] text-slate-500 truncate block cursor-default">
                            {detail.join(', ')}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                          <ul className="space-y-1">
                            {detail.map((d, j) => (
                              <li key={j} className="flex items-center gap-2 text-[13px] text-slate-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{d}
                              </li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    ) : <span className="text-slate-300">&mdash;</span>}
                  </td>

                  {/* Notes / Incidents — tooltip full text */}
                  <td className="px-3 py-2.5">
                    {notesTxt ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[13px] text-slate-500 truncate block cursor-default">
                            {notesTxt}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                          <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{notesTxt}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : <span className="text-slate-300">&mdash;</span>}
                  </td>

                  <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
                    {date ? formatQualityDate(date) : <span className="text-slate-300">&mdash;</span>}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <a href={href} target="_blank" rel="noreferrer"
                      className="text-slate-400 hover:text-primary transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
            {a.file_size && (
              <span className="text-[11px] text-slate-400 shrink-0">
                {(a.file_size / 1024).toFixed(0)} KB
              </span>
            )}
            <a
              href={`/api/writeups/${writeup.id}/attachments/${a.id}`}
              target="_blank" rel="noopener noreferrer"
              className="text-primary hover:text-primary/80 shrink-0"
              title="View / Download"
            >
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
  const showStatuses = ['DELIVERED', 'AWAITING_SIGNATURE', 'SIGNED', 'FOLLOW_UP_PENDING', 'CLOSED']
  if (!showStatuses.includes(writeup.status)) return null
  return (
    <Section title="Meeting Notes">
      <NoteBlock text={writeup.meeting_notes} placeholder="No meeting notes recorded." />
    </Section>
  )
}

// ── 7. Follow-Up ──────────────────────────────────────────────────────────────

function FollowUpSection({ writeup }: { writeup: WriteUpDetail }) {
  const show = writeup.status === 'FOLLOW_UP_PENDING' ||
    (writeup.status === 'CLOSED' && writeup.follow_up_required)
  if (!show) return null

  return (
    <Section title="Follow-Up">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <InfoRow label="Follow-Up Date"
          value={writeup.follow_up_date ? formatQualityDate(writeup.follow_up_date) : null} />
        <InfoRow label="Assigned To" value={writeup.follow_up_assignee_name ?? null} />
      </div>

      {writeup.follow_up_checklist && (
        <Sub title="Checklist">
          <NoteBlock text={writeup.follow_up_checklist} placeholder="" />
        </Sub>
      )}

      {writeup.follow_up_notes && (
        <Sub title="Follow-Up Notes">
          <NoteBlock text={writeup.follow_up_notes} placeholder="" />
        </Sub>
      )}
    </Section>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ContentSections({ writeup }: { writeup: WriteUpDetail }) {
  return (
    <>
      <OverviewSection     writeup={writeup} />
      <IncidentsSection    writeup={writeup} />
      <CorrectiveSection   writeup={writeup} />
      <PriorDisciplineSection writeup={writeup} />
      <AttachmentsSection  writeup={writeup} />
      <MeetingNotesSection writeup={writeup} />
      <FollowUpSection     writeup={writeup} />
    </>
  )
}
