import { Pencil, FileText, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Section, SectionLabel, NoteBlock } from '@/components/common/DetailLayout'
import { STATUS_LABELS } from '@/constants/labels'
import { cn } from '@/lib/utils'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'
import qaService from '@/services/qaService'
import { EditDisputeForm } from './DisputeForms'

interface Dispute {
  id:               number
  reason:           string
  status:           string
  resolution_notes?: string | null
  attachment_url?:   string | null
  resolved_by?:      number | null
  created_at?:       string
  resolved_at?:      string
}

export interface ResolutionState {
  isActive:       boolean
  notes:          string
  error:          string | null
  isSubmitting:   boolean
  onEnter:        () => void
  onCancel:       () => void
  onChangeNotes:  (v: string) => void
  onSubmit:       (action: 'UPHOLD' | 'ADJUST') => void
}

interface Props {
  submissionId:     number
  dispute:          Dispute
  isAgent:          boolean
  editingDispute:   boolean
  onEditDispute:    (v: boolean) => void
  canResolveDispute: boolean
  resolution:       ResolutionState
  formData:         any
}

export function DisputePanel({
  submissionId, dispute, isAgent, editingDispute, onEditDispute,
  canResolveDispute, resolution, formData,
}: Props) {
  const headerRight = (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-slate-500 flex items-center gap-1.5">
        Status: <span className="text-[15px] font-semibold text-primary">{STATUS_LABELS[dispute.status] ?? dispute.status}</span>
      </span>
      {isAgent && dispute.status === 'OPEN' && !dispute.resolved_by && !editingDispute && (
        <button className="text-[12px] text-primary hover:text-primary/80 transition-colors font-medium flex items-center gap-1"
          onClick={() => onEditDispute(true)}>
          <Pencil className="h-3 w-3" /> Edit
        </button>
      )}
    </div>
  )

  return (
    <>
      <Section title="Dispute" headerRight={headerRight}>
        <div className="space-y-3">
          <div className="flex gap-4 text-[11px] text-slate-400">
            {dispute.created_at  && <span>Filed {fmtDate(dispute.created_at)}</span>}
            {dispute.resolved_at && <span>· Resolved {fmtDate(dispute.resolved_at)}</span>}
          </div>

          {editingDispute ? (
            <EditDisputeForm
              submissionId={submissionId}
              dispute={dispute}
              onSuccess={() => onEditDispute(false)}
              onCancel={() => onEditDispute(false)}
            />
          ) : (
            <>
              <div>
                <SectionLabel>Dispute Reason</SectionLabel>
                <div className="bg-slate-50 rounded-lg p-3">
                  <NoteBlock text={dispute.reason} placeholder="No reason provided" />
                </div>
              </div>

              {dispute.attachment_url && (
                <div>
                  <SectionLabel>Supporting Evidence</SectionLabel>
                  <button
                    onClick={() => qaService.downloadDisputeAttachment(
                      dispute.id,
                      dispute.attachment_url!.split('/').pop() || 'attachment'
                    )}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors w-full text-left"
                  >
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12px] text-primary font-medium truncate">
                        {dispute.attachment_url.split('/').pop()}
                      </p>
                      <p className="text-[11px] text-slate-400">Supporting evidence uploaded with dispute</p>
                    </div>
                  </button>
                </div>
              )}

              {dispute.status !== 'OPEN' ? (
                dispute.resolution_notes && (
                  <div className="border-t border-slate-100 pt-3">
                    <SectionLabel>Resolution Notes</SectionLabel>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <NoteBlock text={dispute.resolution_notes} placeholder="" />
                    </div>
                  </div>
                )
              ) : (
                <p className="text-[13px] text-slate-400 italic">Awaiting manager review.</p>
              )}
            </>
          )}
        </div>
      </Section>

      {/* ── Resolve dispute (manager / admin) ───────────────────────────── */}
      {canResolveDispute && dispute.status === 'OPEN' && (
        <div className={cn('rounded-xl border overflow-hidden',
          resolution.isActive ? 'border-amber-300' : 'border-slate-200 bg-white')}>
          <div className={cn('px-5 py-3 border-b',
            resolution.isActive ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100')}>
            <h3 className="text-[15px] font-semibold text-slate-800">Resolve Dispute</h3>
          </div>
          <div className={cn('px-5 py-4 space-y-3', resolution.isActive ? 'bg-amber-50/50' : 'bg-white')}>
            {!resolution.isActive ? (
              <>
                <p className="text-[13px] text-slate-500">
                  Review the dispute reason and score breakdown, then choose how to resolve.
                </p>
                <Button size="sm" className="w-full bg-primary hover:bg-primary/90 text-white"
                  onClick={resolution.onEnter} disabled={!formData}>
                  <Edit3 className="h-3.5 w-3.5 mr-1.5" /> Start Resolution
                </Button>
                {!formData && <p className="text-[11px] text-amber-600">Loading form data…</p>}
              </>
            ) : (
              <>
                <div>
                  <SectionLabel>
                    Resolution Notes <span className="text-red-400 normal-case font-normal">required</span>
                  </SectionLabel>
                  <RichTextEditor
                    value={resolution.notes}
                    onChange={resolution.onChangeNotes}
                    placeholder="Explain your decision…"
                    className="mt-1 text-[13px]"
                  />
                </div>
                {resolution.error && (
                  <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">
                    {resolution.error}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    disabled={resolution.isSubmitting}
                    onClick={() => resolution.onSubmit('UPHOLD')}>
                    Uphold Score
                  </Button>
                  <Button size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={resolution.isSubmitting}
                    onClick={() => resolution.onSubmit('ADJUST')}>
                    {resolution.isSubmitting ? 'Saving…' : 'Adjust Score'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
