import { ExternalLink } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { formatQualityDate } from '@/utils/dateFormat'
import { RichTextDisplay } from '@/components/common/RichTextDisplay'
import { Section, InfoRow, type DetailSectionProps } from './layout'

export function IncidentsSection({ writeup }: DetailSectionProps) {
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
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Incident #{i + 1}</span>
            </div>

            {/* 1. Policy Violated + Reference Material */}
            {inc.violations?.map((v) => (
              <div key={v.id} className="px-4 py-3 border-b border-slate-100">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <InfoRow label="Policy Violated" value={v.policy_violated} />
                  <InfoRow label="Reference Material" value={v.reference_material ?? null} />
                </div>
              </div>
            ))}

            {/* 2. Description */}
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Description</p>
              <RichTextDisplay html={inc.description} placeholder="No description" />
            </div>

            {/* 3. Examples (single consolidated section) */}
            {(() => {
              const allExamples = inc.violations?.flatMap(v => v.examples ?? []) ?? []
              if (allExamples.length === 0) return null
              return (
                <div className="px-4 py-3">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Examples</p>
                  <Table className="w-full text-[13px]">
                    <TableHeader>
                      <StandardTableHeaderRow>
                        <TableHead className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[90px]">Type</TableHead>
                        <TableHead className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide w-[110px]">Date</TableHead>
                        <TableHead className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notes</TableHead>
                        <TableHead className="px-3 py-2 w-[44px]" />
                      </StandardTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {allExamples.map((ex, ei) => (
                        <TableRow key={ex.id ?? ei} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                          <TableCell className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                            {ex.source === 'QA_IMPORT' ? 'QA' : ex.source === 'COACHING_IMPORT' ? 'Coaching' : 'Manual'}
                          </TableCell>
                          <TableCell className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                            {ex.example_date ? formatQualityDate(ex.example_date) : <span className="text-slate-300">&mdash;</span>}
                          </TableCell>
                          <TableCell className="px-3 py-2.5 text-slate-600 leading-relaxed"><RichTextDisplay html={ex.description} placeholder="—" /></TableCell>
                          <TableCell className="px-3 py-2.5 text-center">
                            {ex.source === 'QA_IMPORT' && ex.qa_submission_id && (
                              <a href={`/app/quality/submissions/${ex.qa_submission_id}`} target="_blank" rel="noopener noreferrer"
                                className="text-slate-400 hover:text-primary transition-colors" title="View completed QA form">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            })()}
          </div>
        ))}
      </div>
    </Section>
  )
}
