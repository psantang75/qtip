import { ShieldCheck } from 'lucide-react'
import { InsightsSection, StatRow, StatusBadge } from '@/components/insights'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentProfile } from '@/services/insightsQCService'
import { TL, TC, SL } from './agentProfileHelpers'

interface Props {
  wus: AgentProfile['writeUps']
}

export default function AgentWarningsSection({ wus }: Props) {
  return (
    <>
      <div className="text-sm font-bold text-slate-800 pb-1.5 border-b-2 border-red-500">Performance Warnings</div>

      <InsightsSection title="Warning History">
        {wus.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ShieldCheck size={32} className="text-primary mb-3" />
            <p className="text-sm font-medium text-slate-600">No performance warnings for the selected period</p>
          </div>
        ) : (
          <>
            <TooltipProvider delayDuration={200}>
            <table className="w-full text-xs mb-4">
              <thead><tr className="text-slate-400 border-b border-slate-200">
                {['Type','Status','Created','Meeting','Follow-Up','Manager','Prior','Coaching','Policies'].map(h => <th key={h} className="text-left py-1.5 font-medium pr-3">{h}</th>)}
              </tr></thead>
              <tbody>
                {wus.map(w => (
                  <tr key={w.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${TC[w.type] ?? 'text-slate-600 bg-slate-100 border-slate-200'}`}>{TL[w.type] ?? w.type}</span></td>
                    <td className="py-2 pr-3 text-slate-600">{SL[w.status] ?? w.status}</td>
                    <td className="py-2 pr-3 text-slate-500">{w.date}</td>
                    <td className="py-2 pr-3 text-slate-500">{w.meetingDate ?? '—'}</td>
                    <td className={`py-2 pr-3 ${w.followUpDate ? 'text-orange-500 font-medium' : 'text-slate-400'}`}>{w.followUpDate ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-500">{w.managerName ?? '—'}</td>
                    <td className={`py-2 pr-3 font-bold ${w.priorCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{w.priorCount}</td>
                    <td className="py-2 pr-3"><span className={`font-bold text-sm ${w.linkedCoaching ? 'text-emerald-600' : 'text-red-500'}`}>{w.linkedCoaching ? '✓' : '✗'}</span></td>
                    <td className="py-2 max-w-[140px]">
                      {w.policies.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-slate-500 truncate block cursor-default">{w.policies.join(', ')}</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6} className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                            <ul className="space-y-1">
                              {w.policies.map((p, i) => (
                                <li key={`${p}-${i}`} className="flex items-center gap-2 text-[13px] text-slate-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{p}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TooltipProvider>
            <StatRow label="Total Warnings (Period)"  value={String(wus.length)} valueColor="text-orange-500" />
            <StatRow label="Pending Follow-Ups"       value={String(wus.filter(w => w.status === 'FOLLOW_UP_PENDING').length)} />
          </>
        )}
      </InsightsSection>
    </>
  )
}
