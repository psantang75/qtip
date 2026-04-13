import { ExternalLink } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatQualityDate } from '@/utils/dateFormat'
import type { PriorDisciplineRow } from '@/services/writeupService'
import { Section, type DetailSectionProps } from './layout'
import {
  WRITE_UP_TYPE_LABELS as TYPE_LABELS,
  WRITE_UP_STATUS_LABELS as STATUS_LABELS,
  COACHING_STATUS_LABELS,
  PURPOSE_LABELS,
} from '../writeupLabels'

export function PriorDisciplineSection({ writeup }: DetailSectionProps) {
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
            <col className="w-[90px]" /><col className="w-[150px]" /><col className="w-[110px]" />
            <col className="w-[160px]" /><col className="w-[160px]" /><col className="w-[130px]" /><col className="w-[44px]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['Type','Purpose / Type','Status','Topic / Policy','Notes / Incidents','Date',''].map(h => (
                <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((pd: PriorDisciplineRow, i: number) => {
              const isWriteUp    = pd.reference_type === 'write_up'
              const detail       = splitSep(isWriteUp ? pd.policies_violated  : pd.topic_names)
              const notesTxt     = isWriteUp ? splitSep(pd.incident_descriptions).join(' | ') : pd.notes
              const statusLabel  = isWriteUp ? (STATUS_LABELS[pd.status] ?? pd.status) : (COACHING_STATUS_LABELS[pd.status ?? ''] ?? pd.status)
              const subtypeLabel = isWriteUp ? (TYPE_LABELS[pd.document_type] ?? pd.document_type) : (PURPOSE_LABELS[pd.coaching_purpose ?? ''] ?? pd.coaching_purpose)
              const date         = pd.date ? String(pd.date).slice(0, 10) : undefined
              const href         = isWriteUp ? `/app/performancewarnings/${pd.reference_id}` : `/app/training/coaching/${pd.reference_id}`

              return (
                <tr key={i} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">{isWriteUp ? 'Write-Up' : 'Coaching'}</td>
                  <td className="px-3 py-2.5 text-[13px] text-slate-600 truncate">{subtypeLabel ?? <span className="text-slate-300">&mdash;</span>}</td>
                  <td className="px-3 py-2.5 text-[13px] text-slate-600">{statusLabel ?? <span className="text-slate-300">&mdash;</span>}</td>
                  <td className="px-3 py-2.5">
                    {detail.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{detail.join(', ')}</span></TooltipTrigger>
                        <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                          <ul className="space-y-1">{detail.map((d, j) => <li key={j} className="flex items-center gap-2 text-[13px] text-slate-700"><span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{d}</li>)}</ul>
                        </TooltipContent>
                      </Tooltip>
                    ) : <span className="text-slate-300">&mdash;</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {notesTxt ? (
                      <Tooltip>
                        <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{notesTxt}</span></TooltipTrigger>
                        <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}><p className="text-[13px] text-slate-700 whitespace-pre-wrap">{notesTxt}</p></TooltipContent>
                      </Tooltip>
                    ) : <span className="text-slate-300">&mdash;</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-slate-600 whitespace-nowrap">
                    {date ? formatQualityDate(date) : <span className="text-slate-300">&mdash;</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <a href={href} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary transition-colors"><ExternalLink className="h-3.5 w-3.5" /></a>
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
