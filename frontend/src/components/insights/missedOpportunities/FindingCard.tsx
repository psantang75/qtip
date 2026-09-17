/**
 * One miss on a call: category first, then summary, quote, recommended
 * approach, and how to recover the account. Interaction facts (time, call,
 * ticket) live on the parent so they are not repeated per miss.
 */
import { Quote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SEVERITY_CHIP } from './findingsFormat'
import type { MissedOpportunityFinding } from '@/types/missedOpportunities'

export default function FindingCard({ finding: f }: { finding: MissedOpportunityFinding }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
          {f.category ?? f.ruleName ?? f.ruleKey}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_CHIP[f.severity])}>
          {f.severity}
        </span>
      </div>

      <h4 className="mt-1.5 text-[13px] font-semibold text-slate-900">{f.title}</h4>
      <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-700">Interaction summary and specific miss</div>
      <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-slate-600">{f.whatHappened}</p>

      {f.evidenceQuote && (
        <blockquote className="mt-2 flex gap-2 rounded-md border-l-2 border-slate-300 bg-surface px-3 py-2">
          <Quote className="h-3 w-3 shrink-0 text-slate-300" />
          <span className="min-w-0 text-[12px] italic leading-relaxed text-slate-500">
            {f.evidenceSpeaker && (
              <span
                className={cn(
                  'mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase not-italic tracking-wide',
                  f.evidenceSpeaker === 'CUSTOMER'
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-primary/10 text-primary',
                )}
              >
                {f.evidenceSpeaker === 'CUSTOMER' ? 'Customer' : 'Rep'}
              </span>
            )}
            {f.evidenceQuote}
          </span>
        </blockquote>
      )}

      <div className="mt-2 rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">
          Next time: what to say and do
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-700">{f.recommendedApproach}</p>
      </div>

      {f.recoveryAction && (
        <div className="mt-2 rounded-md border-l-2 border-warning bg-warning/5 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-warning">
            Recovery: next action
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-700">{f.recoveryAction}</p>
        </div>
      )}

      {f.estValueNote && (
        <p className="mt-2 text-[11px] text-slate-400">Value at stake: {f.estValueNote}</p>
      )}
    </div>
  )
}
