import { ExternalLink } from 'lucide-react'
import { formatQualityDate } from '@/utils/dateFormat'
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
            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Description</p>
              <p className="text-[13px] text-slate-700 leading-relaxed">{inc.description}</p>
            </div>
            {inc.violations?.map((v) => (
              <div key={v.id} className="border-t border-slate-200">
                <div className="px-4 py-3 bg-white">
                  <div className="grid grid-cols-3 gap-x-8">
                    <InfoRow label="Policy Violated" value={<span className="font-medium text-slate-800">{v.policy_violated}</span>} />
                    <InfoRow label="Reference Material" value={v.reference_material ?? null} />
                  </div>
                  {(v.examples?.length ?? 0) > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Examples</p>
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
                                <td className="px-3 py-2.5 text-slate-600 leading-relaxed">{ex.description}</td>
                                <td className="px-3 py-2.5 text-center">
                                  {ex.source === 'QA_IMPORT' && ex.qa_submission_id && (
                                    <a href={`/app/quality/submissions/${ex.qa_submission_id}`} target="_blank" rel="noopener noreferrer"
                                      className="text-slate-400 hover:text-primary transition-colors" title="View completed QA form">
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
