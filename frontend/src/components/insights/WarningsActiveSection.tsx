import { InsightsSection, StatRow, StatusBadge } from '@/components/insights'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ShieldCheck } from 'lucide-react'

const TYPE_LABEL: Record<string, string> = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' }
const TYPE_COLOR: Record<string, string> = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' }
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', DELIVERED: 'Delivered', AWAITING_SIGNATURE: 'Awaiting Sig.', SIGNED: 'Signed', FOLLOW_UP_PENDING: 'Follow-Up', CLOSED: 'Closed' }
const STATUS_DOT: Record<string, string>  = { DRAFT: 'bg-slate-400', SCHEDULED: 'bg-purple-500', DELIVERED: 'bg-primary', AWAITING_SIGNATURE: 'bg-orange-500', SIGNED: 'bg-yellow-500', FOLLOW_UP_PENDING: 'bg-red-500', CLOSED: 'bg-emerald-500' }

function TypeBadge({ type }: { type: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${TYPE_COLOR[type] ?? 'text-slate-600 bg-slate-100 border-slate-200'}`}>{TYPE_LABEL[type] ?? type}</span>
}

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

interface ActiveWriteUp {
  id: number
  userId: number
  agent: string
  dept: string
  type: string
  status: string
  date: string
  meetingDate: string | null
  followUpDate: string | null
  priorCount: number
  policies: string[]
}

interface EscalationData {
  verbal: number
  written: number
  final: number
}

interface Props {
  activeWriteUps: ActiveWriteUp[]
  escalation: EscalationData | undefined
  cur: Record<string, number | null>
  onNavAgent: (userId: number) => void
}

export default function WarningsActiveSection({
  activeWriteUps, escalation, cur, onNavAgent,
}: Props) {
  const repeatWUs = activeWriteUps.filter(w => w.priorCount > 0)

  return (
    <>
      <InsightsSection title="Active Performance Warnings">
        {activeWriteUps.length === 0
          ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ShieldCheck size={28} className="text-primary mb-2" />
              <p className="text-sm font-medium text-slate-600">No active performance warnings for this period</p>
            </div>
          )
          : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                {['Agent','Department','Type','Status','Created','Meeting','Follow-Up','Prior','Policies'].map(h => <th key={h} className="text-left pb-2 font-medium pr-3 last:pr-0">{h}</th>)}
              </tr></thead>
              <TooltipProvider delayDuration={200}>
              <tbody>
                {activeWriteUps.map(w => (
                  <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-medium text-primary hover:underline cursor-pointer" onClick={() => onNavAgent(w.userId)}>{w.agent}</td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">{w.dept}</td>
                    <td className="py-2.5 pr-3"><TypeBadge type={w.type} /></td>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[w.status] ?? 'bg-slate-300'}`} />
                        <span className="text-xs text-slate-600">{STATUS_LABEL[w.status] ?? w.status}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">{w.date}</td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">{w.meetingDate ?? '—'}</td>
                    <td className={`py-2.5 pr-3 text-xs ${w.followUpDate ? 'text-orange-500 font-medium' : 'text-slate-400'}`}>{w.followUpDate ?? '—'}</td>
                    <td className={`py-2.5 pr-3 font-bold ${w.priorCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{w.priorCount}</td>
                    <td className="py-2.5 text-xs text-slate-500 max-w-[160px]">
                      {w.policies.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate block cursor-default">{w.policies.join(', ')}</span>
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
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              </TooltipProvider>
            </table>
          )
        }
      </InsightsSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection title="Escalation Path">
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center py-4 mb-3 gap-x-5">
            {[
              { label: 'Verbal',  count: escalation?.verbal  ?? 0, ring: 'border-yellow-400', bg: 'bg-yellow-50',  text: 'text-yellow-600' },
              { label: 'Written', count: escalation?.written ?? 0, ring: 'border-orange-400', bg: 'bg-orange-50',  text: 'text-orange-600' },
              { label: 'Final',   count: escalation?.final   ?? 0, ring: 'border-red-400',    bg: 'bg-red-50',     text: 'text-red-600'    },
            ].flatMap((b, i) => [
              <div key={b.label} className={`${b.bg} border-2 ${b.ring} rounded-xl py-5 text-center`}>
                <div className="text-xs text-slate-500 mb-1">{b.label}</div>
                <div className={`text-3xl font-bold ${b.text}`}>{b.count}</div>
              </div>,
              ...(i < 2 ? [<span key={`arrow-${i}`} className="text-slate-300 text-2xl">→</span>] : []),
            ])}
          </div>
          <StatRow label="Escalation Rate" value={fmt(cur.escalation_rate, '%')} />
          <StatRow label="Repeat Offender Rate" value={fmt(cur.repeat_offender_rate, '%')} />
          <StatRow label="Agents on Final Warning" value={String(escalation?.final ?? 0)} valueColor={(escalation?.final ?? 0) > 0 ? 'text-red-600' : undefined} />
        </InsightsSection>

        <InsightsSection title="Repeat Warning Agents">
          {repeatWUs.length === 0
            ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShieldCheck size={32} className="text-primary mb-3" />
                <p className="text-sm font-medium text-slate-600">No repeat warnings during the selected period</p>
              </div>
            )
            : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                  {['Agent','Department','Type','Status','Prior Warnings'].map(h => <th key={h} className="text-left pb-2 font-medium pr-3 last:pr-0">{h}</th>)}
                </tr></thead>
                <tbody>
                  {repeatWUs.map(w => (
                    <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium text-primary hover:underline cursor-pointer" onClick={() => onNavAgent(w.userId)}>{w.agent}</td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">{w.dept}</td>
                      <td className="py-2.5 pr-3"><TypeBadge type={w.type} /></td>
                      <td className="py-2.5 pr-3 text-xs text-slate-600">{STATUS_LABEL[w.status] ?? w.status}</td>
                      <td className={`py-2.5 font-bold ${w.priorCount >= 2 ? 'text-red-600' : 'text-orange-500'}`}>{w.priorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>
      </div>
    </>
  )
}
