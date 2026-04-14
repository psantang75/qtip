import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Link2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { RichTextDisplay } from '@/components/common/RichTextDisplay'
import { Dialog } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FormSection, Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { formatQualityDate } from '@/utils/dateFormat'
import trainingService from '@/services/trainingService'
import listService from '@/services/listService'
import type { WriteUpFormState } from './types'
import { AssignCoachingModal, CreateCoachingModal, PURPOSE_LABELS, FORMAT_LABELS, SOURCE_LABELS } from './AssignCoachingModal'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

export function CorrectiveSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const [showModal, setShowModal]             = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data: linkedSession } = useQuery({
    queryKey: ['cs-detail-for-writeup', form.linked_coaching_id],
    queryFn:  () => trainingService.getCoachingSessionDetail(form.linked_coaching_id!),
    enabled:  (form.linked_coaching_id ?? 0) > 0,
    staleTime: 5 * 60_000,
  })

  const { data: timelineItems = [] } = useQuery({
    queryKey: ['list-items', 'writeup_timeline'],
    queryFn:  () => listService.getItems('writeup_timeline'),
    staleTime: 5 * 60_000,
  })
  const { data: consequenceItems = [] } = useQuery({
    queryKey: ['list-items', 'writeup_consequence'],
    queryFn:  () => listService.getItems('writeup_consequence'),
    staleTime: 5 * 60_000,
  })

  const activeTimelines    = timelineItems.filter(i => i.is_active)
  const activeConsequences = consequenceItems.filter(i => i.is_active)
  const timelineNotInList    = form.correction_timeline && !activeTimelines.some(i => i.label === form.correction_timeline)
  const consequenceNotInList = form.consequence && !activeConsequences.some(i => i.label === form.consequence)

  return (
    <FormSection title="Corrective Action & Expectations">
      <div className="space-y-4">
        <Field label="Required Corrective Action" required>
          <RichTextEditor className="text-[13px]"
            placeholder="Describe the corrective action required…"
            value={form.corrective_action}
            onChange={html => update('corrective_action', html)} />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Timeline for Correction">
            <Select value={form.correction_timeline || ''}
              onValueChange={v => update('correction_timeline', v === '__clear__' ? '' : v)}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Select timeline…" /></SelectTrigger>
              <SelectContent>
                {form.correction_timeline && <SelectItem value="__clear__" className="text-slate-400 italic">— Clear —</SelectItem>}
                {timelineNotInList && <SelectItem value={form.correction_timeline}>{form.correction_timeline}</SelectItem>}
                {activeTimelines.map(i => <SelectItem key={i.id} value={i.label}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Consequence if Not Met">
            <Select value={form.consequence || ''}
              onValueChange={v => update('consequence', v === '__clear__' ? '' : v)}>
              <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Select consequence…" /></SelectTrigger>
              <SelectContent>
                {form.consequence && <SelectItem value="__clear__" className="text-slate-400 italic">— Clear —</SelectItem>}
                {consequenceNotInList && <SelectItem value={form.consequence}>{form.consequence}</SelectItem>}
                {activeConsequences.map(i => <SelectItem key={i.id} value={i.label}>{i.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Follow-Up Meeting Date">
            <Input type="date" className="h-9 text-[13px]" value={form.checkin_date}
              onChange={e => update('checkin_date', e.target.value)} />
          </Field>
        </div>

        <div>
          <p className="text-[13px] font-medium text-slate-700 mb-2">Linked Coaching Session</p>
          {form.linked_coaching_id ? (
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <table className="w-full text-[13px] table-fixed">
                <colgroup>
                  <col className="w-[80px]" /><col className="w-[130px]" /><col className="w-[160px]" />
                  <col className="w-[150px]" /><col className="w-[160px]" /><col /><col /><col className="w-[120px]" /><col className="w-[64px]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['#','Status','Purpose','Format','Source','Topics','Notes','Session Date',''].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-[13px] text-slate-500 font-mono whitespace-nowrap">#{form.linked_coaching_id}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">{linkedSession ? (linkedSession.status ?? '').replace(/_/g, ' ') : <span className="text-slate-300">&mdash;</span>}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">{linkedSession ? (PURPOSE_LABELS[linkedSession.coaching_purpose] ?? linkedSession.coaching_purpose) : <span className="text-slate-300">&mdash;</span>}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">{linkedSession ? (FORMAT_LABELS[linkedSession.coaching_format] ?? linkedSession.coaching_format?.replace(/_/g, ' ')) : <span className="text-slate-300">&mdash;</span>}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">{linkedSession ? (SOURCE_LABELS[linkedSession.source_type ?? ''] ?? linkedSession.source_type ?? <span className="text-slate-300">&mdash;</span>) : <span className="text-slate-300">&mdash;</span>}</td>
                    <td className="px-3 py-2.5">
                      {linkedSession && (linkedSession.topics ?? []).length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{linkedSession.topics.join(', ')}</span></TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">{linkedSession.topics.map(t => <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700"><span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}</li>)}</ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {linkedSession?.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{linkedSession.notes}</span></TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}><RichTextDisplay html={linkedSession.notes} /></TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">{linkedSession?.session_date ? formatQualityDate(linkedSession.session_date) : <span className="text-slate-300">&mdash;</span>}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <a href={`/app/training/coaching/${form.linked_coaching_id}`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary" title="Open in Training"><ExternalLink className="h-3.5 w-3.5" /></a>
                        <Button type="button" variant="ghost" size="sm" className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                          onClick={() => { update('linked_coaching_id', null); update('linked_coaching_label', '') }}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="outline" size="sm" className="text-[13px]" onClick={() => setShowModal(true)}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" /> Link Existing Session
              </Button>
              <Button type="button" variant="outline" size="sm" className="text-[13px]" onClick={() => setShowCreateModal(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Create &amp; Link Session
              </Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        {showModal && (
          <AssignCoachingModal csrId={form.csr_id}
            onSelect={(id, label) => { update('linked_coaching_id', id); update('linked_coaching_label', label) }}
            onClose={() => setShowModal(false)} />
        )}
      </Dialog>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        {showCreateModal && (
          <CreateCoachingModal csrId={form.csr_id}
            onCreated={(id, label) => { update('linked_coaching_id', id); update('linked_coaching_label', label) }}
            onClose={() => setShowCreateModal(false)} />
        )}
      </Dialog>
    </FormSection>
  )
}
