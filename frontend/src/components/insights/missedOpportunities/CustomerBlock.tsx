/**
 * One customer under an agent: header with category pills, then each call
 * that day, then the misses on that call. Always expanded — only the agent
 * row collapses, so opening a rep shows every account they missed on.
 */
import { ExternalLink, Headphones, Phone, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildCrmUrl } from '@/utils/crmLinks'
import { cn } from '@/lib/utils'
import FindingCard from './FindingCard'
import { formatCallStamp, formatDirection, formatTalkMins, SEVERITY_CHIP } from './findingsFormat'
import { uniqueCategories, type CustomerGroup } from './groupFindings'
import type { MissedOpportunityFinding } from '@/types/missedOpportunities'

interface CustomerBlockProps {
  group: CustomerGroup<MissedOpportunityFinding>
  onOpenCall: (conversationId: string) => void
}

export default function CustomerBlock({ group, onOpenCall }: CustomerBlockProps) {
  const categories = uniqueCategories(group.findings)
  const highCount = group.findings.filter((f) => f.severity === 'high').length
  const callCount = group.interactions.length
  const missCount = group.findings.length

  return (
    <div className="rounded-lg border border-slate-200 bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-[13px] font-semibold text-slate-900">{group.customerName}</h4>
          {categories.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {categories.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {highCount > 0 && (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_CHIP.high)}>
              {highCount} high
            </span>
          )}
          <span className="text-[12px] text-slate-500">
            {callCount} {callCount === 1 ? 'call' : 'calls'} · {missCount} {missCount === 1 ? 'miss' : 'misses'}
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {group.interactions.map((ix, i) => (
          <div key={ix.key} className={i > 0 ? 'border-t border-slate-200 pt-3' : undefined}>
            <InteractionChrome findings={ix.findings} onOpenCall={onOpenCall} />
            <div className="mt-2 space-y-2">
              {ix.findings.map((f) => (
                <FindingCard key={f.findingId} finding={f} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InteractionChrome({ findings, onOpenCall }: {
  findings: MissedOpportunityFinding[]
  onOpenCall: (conversationId: string) => void
}) {
  const f = findings[0]
  const stamp = formatCallStamp(f.callDate)
  const talk = formatTalkMins(f.talkSecs)
  const crmLinks = uniqueCrmRefs(findings)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
      <span className="inline-flex items-center gap-1">
        <Phone className="h-3 w-3" />
        {formatDirection(f.direction)}
        {talk && ` · ${talk}`}
      </span>
      {stamp && (
        <span>
          {stamp.date} · {stamp.time}
        </span>
      )}
      {f.conversationId && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => onOpenCall(f.conversationId!)}
          title="Play the recording and read the transcript for this call"
          className="h-auto min-w-0 px-0 py-0 text-[12px] font-medium"
        >
          <Headphones className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono text-[10.5px]">{f.conversationId}</span>
        </Button>
      )}
      {crmLinks.length > 0
        ? crmLinks.map((crm) => (
            <a
              key={`${crm.kind}-${crm.id}`}
              href={buildCrmUrl(crm.kind, crm.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${crm.kind === 'TASK' ? 'task' : 'ticket'} ${crm.id} in the CRM`}
              className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 hover:underline"
            >
              <Ticket className="h-3 w-3 shrink-0" />
              {crm.kind === 'TASK' ? 'Task' : 'Ticket'} {crm.id}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ))
        : (
          <span
            className="inline-flex items-center gap-1 text-slate-400"
            title="We couldn't tie this call's phone number to a single CRM task or ticket to verify."
          >
            <Ticket className="h-3 w-3 shrink-0" />
            CRM task/ticket not verified
          </span>
        )}
    </div>
  )
}

function uniqueCrmRefs(findings: MissedOpportunityFinding[]): { kind: 'TASK' | 'TICKET'; id: number }[] {
  const seen = new Set<string>()
  const out: { kind: 'TASK' | 'TICKET'; id: number }[] = []
  for (const f of findings) {
    if (!f.crmRefKind || f.crmRefId == null) continue
    const key = `${f.crmRefKind}:${f.crmRefId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: f.crmRefKind, id: f.crmRefId })
  }
  return out
}
