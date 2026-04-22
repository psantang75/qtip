import { InsightsSection, StatRow } from '@/components/insights'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ShieldCheck } from 'lucide-react'
import type { EscalationData, RepeatWarningAgent } from '@/services/insightsQCService'

const TYPE_LABEL: Record<string, string> = { VERBAL_WARNING: 'Verbal', WRITTEN_WARNING: 'Written', FINAL_WARNING: 'Final' }
const TYPE_COLOR: Record<string, string> = { VERBAL_WARNING: 'text-yellow-600 bg-yellow-50 border-yellow-200', WRITTEN_WARNING: 'text-orange-600 bg-orange-50 border-orange-200', FINAL_WARNING: 'text-red-600 bg-red-50 border-red-200' }
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', AWAITING_SIGNATURE: 'Awaiting Sig.', SIGNED: 'Signed', FOLLOW_UP_PENDING: 'Follow-Up', CLOSED: 'Closed' }
const STATUS_DOT: Record<string, string>  = { DRAFT: 'bg-slate-400', SCHEDULED: 'bg-purple-500', AWAITING_SIGNATURE: 'bg-orange-500', SIGNED: 'bg-yellow-500', FOLLOW_UP_PENDING: 'bg-red-500', CLOSED: 'bg-emerald-500' }

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

interface Props {
  activeWriteUps: ActiveWriteUp[]
  escalation: EscalationData | undefined
  repeatAgents: RepeatWarningAgent[]
  cur: Record<string, number | null>
  onNavAgent: (userId: number) => void
}

// Header cell with a hover tooltip explaining what the column actually counts.
function ColumnHeader({ label, tooltip }: { label: string; tooltip?: string }) {
  if (!tooltip) {
    return <th className="text-left pb-2 font-medium pr-3 last:pr-0">{label}</th>
  }
  return (
    <th className="text-left pb-2 font-medium pr-3 last:pr-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </th>
  )
}

// One Step-Up card (Verbal -> Written or Written -> Final). Shows the
// in-selected-period count, prior-period count, and a colored delta.
// Hovering reveals a tooltip explaining exactly what window is counted.
function StepUpCard({
  label, current, prior, accent, tooltip,
}: {
  label: string
  current: number
  prior: number
  accent: { ring: string; bg: string; text: string }
  tooltip: string
}) {
  const delta     = current - prior
  const deltaText = delta === 0 ? '— flat'
                    : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs prior period`
  const deltaColor = delta === 0
    ? 'text-slate-400'
    : delta > 0 ? 'text-red-500' : 'text-emerald-600'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`${accent.bg} border-2 ${accent.ring} rounded-xl py-5 px-4 text-center cursor-help`}>
          <div className="text-xs text-slate-500 mb-1">{label}</div>
          <div className={`text-3xl font-bold ${accent.text}`}>{current}</div>
          <div className={`text-[11px] mt-1 font-medium ${deltaColor}`}>{deltaText}</div>
          <div className="text-[10px] text-slate-400">Prior period: {prior}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export default function WarningsActiveSection({
  activeWriteUps, escalation, repeatAgents, cur, onNavAgent,
}: Props) {
  const stepUps        = escalation?.stepUps
  const verbalToWritten = stepUps?.current.verbalToWritten ?? 0
  const writtenToFinal  = stepUps?.current.writtenToFinal  ?? 0
  const priorVTW        = stepUps?.prior.verbalToWritten   ?? 0
  const priorWTF        = stepUps?.prior.writtenToFinal    ?? 0
  const agentsOnFinal   = escalation?.agentsOnFinal ?? 0

  return (
    <TooltipProvider delayDuration={200}>
      <InsightsSection title="Active Performance Warnings" infoKpiCodes={['warnings_active_list']}>
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
                <ColumnHeader label="Agent" />
                <ColumnHeader label="Department" />
                <ColumnHeader label="Type" />
                <ColumnHeader label="Status" />
                <ColumnHeader label="Created" />
                <ColumnHeader label="Meeting" />
                <ColumnHeader label="Follow-Up" />
                <ColumnHeader
                  label="Linked"
                  tooltip="Number of prior discipline records the issuing manager attached to this write-up. This reflects what the manager linked on the form, not the agent's full history on file."
                />
                <ColumnHeader label="Policies" />
              </tr></thead>
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
            </table>
          )
        }
      </InsightsSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InsightsSection
          title="Escalation Path (Selected Period)"
          infoKpiCodes={['warnings_escalation_path']}
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center py-2 mb-3 gap-x-5">
            <StepUpCard
              label="Verbal → Written"
              current={verbalToWritten}
              prior={priorVTW}
              accent={{ ring: 'border-orange-400', bg: 'bg-orange-50', text: 'text-orange-600' }}
              tooltip="Number of WRITTEN_WARNING write-ups issued during the selected period to agents whose most recent prior write-up in the trailing 12 months was a VERBAL_WARNING. The bottom number is the same calculation for the prior period."
            />
            <span className="text-slate-300 text-2xl">→</span>
            <StepUpCard
              label="Written → Final"
              current={writtenToFinal}
              prior={priorWTF}
              accent={{ ring: 'border-red-400', bg: 'bg-red-50', text: 'text-red-600' }}
              tooltip="Number of FINAL_WARNING write-ups issued during the selected period to agents whose most recent prior write-up in the trailing 12 months was a VERBAL_WARNING or WRITTEN_WARNING. The bottom number is the same calculation for the prior period."
            />
          </div>
          <StatRow
            label="Escalation Rate (this period)"
            value={fmt(cur.escalation_rate, '%')}
            kpiCode="escalation_rate"
          />
          <StatRow
            label="Repeat Offender Rate (this period)"
            value={fmt(cur.repeat_offender_rate, '%')}
            kpiCode="repeat_offender_rate"
          />
          <StatRow
            label="Agents on Final Warning (this period)"
            value={String(agentsOnFinal)}
            valueColor={agentsOnFinal > 0 ? 'text-red-600' : undefined}
          />
        </InsightsSection>

        <InsightsSection
          title="Repeat Warning Agents (Selected Period)"
          infoKpiCodes={['warnings_repeat_agents']}
        >
          {repeatAgents.length === 0
            ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShieldCheck size={32} className="text-primary mb-3" />
                <p className="text-sm font-medium text-slate-600">No agents received more than one warning during the selected period</p>
              </div>
            )
            : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                  <ColumnHeader label="Agent" />
                  <ColumnHeader label="Department" />
                  <ColumnHeader label="Latest Type" />
                  <ColumnHeader
                    label="In Period"
                    tooltip="Number of write-ups this agent received within the selected reporting period."
                  />
                  <ColumnHeader
                    label="Prior (90d)"
                    tooltip="Write-ups this agent had on file in the 90 days immediately before the start of the selected period."
                  />
                  <ColumnHeader
                    label="Prior (12mo)"
                    tooltip="Write-ups this agent had on file in the 12 months immediately before the start of the selected period."
                  />
                </tr></thead>
                <tbody>
                  {repeatAgents.map(a => (
                    <tr key={a.userId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium text-primary hover:underline cursor-pointer" onClick={() => onNavAgent(a.userId)}>{a.agent}</td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">{a.dept}</td>
                      <td className="py-2.5 pr-3">{a.latestType ? <TypeBadge type={a.latestType} /> : '—'}</td>
                      <td className={`py-2.5 pr-3 font-bold ${a.inPeriod >= 3 ? 'text-red-600' : 'text-orange-500'}`}>{a.inPeriod}</td>
                      <td className={`py-2.5 pr-3 text-sm ${a.prior90d > 0 ? 'text-orange-500 font-medium' : 'text-slate-400'}`}>{a.prior90d}</td>
                      <td className={`py-2.5 text-sm ${a.prior12mo > 0 ? 'text-slate-700 font-medium' : 'text-slate-400'}`}>{a.prior12mo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </InsightsSection>
      </div>
    </TooltipProvider>
  )
}
