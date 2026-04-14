import { ExternalLink } from 'lucide-react'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatQualityDate } from '@/utils/dateFormat'
import { RichTextDisplay } from '@/components/common/RichTextDisplay'
import { Section, Sub, InfoRow, NoteBlock, type DetailSectionProps } from './layout'
import { COACHING_STATUS_LABELS, COACHING_PURPOSE_LABELS as PURPOSE_LABELS } from '@/constants/labels'

export function CorrectiveSection({ writeup }: DetailSectionProps) {
  return (
    <Section title="Corrective Action & Expectations">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Required Corrective Action</p>
      <NoteBlock text={writeup.corrective_action} placeholder="Not specified" />

      <div className="grid grid-cols-3 gap-x-8 gap-y-4 mt-4 pt-4 border-t border-slate-100">
        <InfoRow label="Timeline for Correction" value={writeup.correction_timeline ?? null} />
        <InfoRow label="Follow-Up Meeting Date" value={writeup.checkin_date ? formatQualityDate(writeup.checkin_date) : null} />
        <InfoRow label="Consequence if Not Met" value={writeup.consequence ?? null} />
      </div>

      {writeup.linked_coaching_id && (
        <Sub title="Linked Coaching Session">
          <div className="rounded-lg border border-slate-200 overflow-hidden -mx-1">
            <Table className="w-full text-[13px] table-fixed">
              <colgroup>
                <col className="w-[150px]" /><col className="w-[110px]" /><col className="w-[160px]" />
                <col className="w-[160px]" /><col className="w-[130px]" /><col className="w-[44px]" />
              </colgroup>
              <TableHeader>
                <StandardTableHeaderRow>
                  {['Purpose / Type','Status','Topic','Notes','Date',''].map(h => (
                    <TableHead key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{h}</TableHead>
                  ))}
                </StandardTableHeaderRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const cs = writeup.linked_coaching_session
                  const topics = cs?.topic_names ?? []
                  const statusLabel  = COACHING_STATUS_LABELS[cs?.status ?? ''] ?? cs?.status
                  const purposeLabel = PURPOSE_LABELS[cs?.coaching_purpose ?? ''] ?? cs?.coaching_purpose
                  return (
                    <TableRow className="hover:bg-slate-50/60">
                      <TableCell className="px-3 py-2.5 text-slate-600 truncate">{purposeLabel ?? <span className="text-slate-300">&mdash;</span>}</TableCell>
                      <TableCell className="px-3 py-2.5 text-slate-600">{statusLabel ?? <span className="text-slate-300">&mdash;</span>}</TableCell>
                      <TableCell className="px-3 py-2.5">
                        {topics.length > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{topics.join(', ')}</span></TooltipTrigger>
                            <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}>
                              <ul className="space-y-1">{topics.map((t, i) => <li key={i} className="flex items-center gap-2 text-[13px] text-slate-700"><span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}</li>)}</ul>
                            </TooltipContent>
                          </Tooltip>
                        ) : <span className="text-slate-300">&mdash;</span>}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        {cs?.notes ? (
                          <Tooltip>
                            <TooltipTrigger asChild><span className="text-[13px] text-slate-500 truncate block cursor-default">{cs.notes}</span></TooltipTrigger>
                            <TooltipContent className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg" sideOffset={6}><RichTextDisplay html={cs.notes} /></TooltipContent>
                          </Tooltip>
                        ) : <span className="text-slate-300">&mdash;</span>}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{cs?.date ? formatQualityDate(String(cs.date).slice(0, 10)) : <span className="text-slate-300">&mdash;</span>}</TableCell>
                      <TableCell className="px-3 py-2.5 text-center">
                        <a href={`/app/training/coaching/${writeup.linked_coaching_id}`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-primary transition-colors">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  )
                })()}
              </TableBody>
            </Table>
          </div>
        </Sub>
      )}
    </Section>
  )
}
