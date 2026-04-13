import { useState } from 'react'
import { History, Search, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FormSection } from '@/pages/training/coaching-form/CoachingFormSections'
import { formatQualityDate } from '@/utils/dateFormat'
import {
  WRITE_UP_STATUS_LABELS as WRITEUP_STATUS_LABELS,
  COACHING_STATUS_LABELS,
} from '../writeupLabels'
import { CoachingSearchModal } from './CoachingSearchModal'
import { PriorDisciplineModal } from './PriorDisciplineModal'
import type { WriteUpFormState, PriorDisciplineRef } from './types'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

export function PriorDisciplineSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const [showModal, setShowModal]                 = useState(false)
  const [showCoachingSearch, setShowCoachingSearch] = useState(false)

  const remove = (idx: number) =>
    update('prior_discipline', form.prior_discipline.filter((_, i) => i !== idx))

  const addRefs = (newRefs: PriorDisciplineRef[]) => {
    const existing = new Set(form.prior_discipline.map(r => `${r.reference_type}:${r.reference_id}`))
    update('prior_discipline', [...form.prior_discipline, ...newRefs.filter(r => !existing.has(`${r.reference_type}:${r.reference_id}`))])
  }

  return (
    <FormSection title="Prior Discipline & Coaching History">
      <div className="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" className="text-[13px]" onClick={() => setShowModal(true)}>
          <History className="h-4 w-4 mr-1.5" /> Browse History
        </Button>
        <Button type="button" variant="outline" size="sm" className="text-[13px]" onClick={() => setShowCoachingSearch(true)}>
          <Search className="h-4 w-4 mr-1.5" /> Search Coaching Sessions
        </Button>
      </div>

      {form.prior_discipline.length === 0 ? (
        <p className="text-[13px] text-slate-400 mt-3">No prior discipline linked yet.</p>
      ) : (
        <TooltipProvider delayDuration={200}>
          <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-[13px] table-fixed">
              <colgroup>
                <col className="w-[90px]" /><col className="w-[150px]" /><col className="w-[110px]" />
                <col className="w-[160px]" /><col className="w-[160px]" /><col className="w-[110px]" /><col className="w-[70px]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Type','Purpose / Type','Status','Topic / Policy','Notes / Incidents','Meeting / Session Date',''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.prior_discipline.map((ref, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">{ref.reference_type === 'write_up' ? 'Write-Up' : 'Coaching'}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">{ref.subtype ?? <span className="text-slate-300">&mdash;</span>}</td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600">
                      {ref.status ? (WRITEUP_STATUS_LABELS[ref.status] ?? COACHING_STATUS_LABELS[ref.status] ?? ref.status) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {ref.detail && ref.detail.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{ref.detail.join(', ')}</span></TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                            <ul className="space-y-1">{ref.detail.map((d, j) => <li key={j} className="flex items-center gap-2 text-[13px] text-slate-700"><span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{d}</li>)}</ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {ref.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{ref.notes}</span></TooltipTrigger>
                          <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}><p className="text-[13px] text-slate-700 whitespace-pre-wrap">{ref.notes}</p></TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
                      {ref.date ? formatQualityDate(ref.date) : <span className="text-slate-300">&mdash;</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 justify-end">
                        <a href={ref.reference_type === 'write_up' ? `/app/performancewarnings/${ref.reference_id}` : `/app/training/coaching/${ref.reference_id}`}
                          target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary transition-colors" title="View record">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <Button type="button" variant="ghost" size="sm" className="h-auto w-auto p-0 text-slate-300 hover:text-red-500 hover:bg-transparent"
                          onClick={() => remove(i)} title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <PriorDisciplineModal csrId={form.csr_id} selected={form.prior_discipline}
          onSave={refs => update('prior_discipline', refs)} onClose={() => setShowModal(false)} />
      </Dialog>

      <Dialog open={showCoachingSearch} onOpenChange={setShowCoachingSearch}>
        <CoachingSearchModal csrId={form.csr_id}
          onImportRefs={refs => { addRefs(refs); setShowCoachingSearch(false) }}
          onClose={() => setShowCoachingSearch(false)} />
      </Dialog>
    </FormSection>
  )
}
