/**
 * Per-agent findings list for the Missed Opportunities report.
 *
 * One collapsible block per salesperson. Expanding shows every customer they
 * missed with that day, then each call, then each miss — category, evidence,
 * recommended approach, and how to recover the account.
 *
 * Call recordings open the shared `CallTranscriptModal`; CRM task/ticket
 * links go through `buildCrmUrl`. Nothing call- or CRM-linking is duplicated
 * here.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import CallTranscriptModal from '@/components/insights/agentActivity/CallTranscriptModal'
import { cn } from '@/lib/utils'
import CustomerBlock from './CustomerBlock'
import { groupByCustomerThenInteraction } from './groupFindings'
import { SEVERITY_CHIP } from './findingsFormat'
import type { MissedOpportunityFinding } from '@/types/missedOpportunities'

interface FindingsListProps {
  findings: MissedOpportunityFinding[]
  /** Agents in report order; drives block order and includes zero-miss agents. */
  agentOrder: string[]
}

export default function FindingsList({ findings, agentOrder }: FindingsListProps) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    agentOrder.length > 0 ? { [agentOrder[0]]: true } : {},
  )
  const [openCall, setOpenCall] = useState<string | null>(null)

  if (findings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No missed opportunities found for this period.
      </p>
    )
  }

  const byAgent = new Map<string, MissedOpportunityFinding[]>()
  for (const f of findings) {
    const key = f.agentName ?? 'Unattributed'
    const list = byAgent.get(key)
    if (list) list.push(f)
    else byAgent.set(key, [f])
  }

  const agents = [
    ...agentOrder.filter((a) => byAgent.has(a)),
    ...[...byAgent.keys()].filter((a) => !agentOrder.includes(a)),
  ]

  return (
    <div className="space-y-2">
      {agents.map((agent) => {
        const rows = byAgent.get(agent) ?? []
        const customers = groupByCustomerThenInteraction(rows)
        const isOpen = !!open[agent]
        const highCount = rows.filter((r) => r.severity === 'high').length
        return (
          <div key={agent} className="rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [agent]: !o[agent] }))}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="flex min-w-0 items-center gap-2">
                {isOpen
                  ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                <span className="truncate text-[14px] font-semibold text-slate-900">{agent}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {highCount > 0 && (
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_CHIP.high)}>
                    {highCount} high
                  </span>
                )}
                <span className="text-[12px] text-slate-500">
                  {customers.length} {customers.length === 1 ? 'customer' : 'customers'} · {rows.length} {rows.length === 1 ? 'miss' : 'misses'}
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="space-y-3 border-t border-slate-100 p-4">
                {customers.map((c) => (
                  <CustomerBlock key={c.customerName} group={c} onOpenCall={setOpenCall} />
                ))}
              </div>
            )}
          </div>
        )
      })}

      <CallTranscriptModal conversationId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  )
}
