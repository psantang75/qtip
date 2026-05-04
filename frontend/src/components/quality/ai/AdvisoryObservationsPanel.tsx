/**
 * AdvisoryObservationsPanel — non-scored observations the AI Reviewer
 * emits in submissions.ai_extras.observations.
 *
 * These do NOT affect the submission score. They surface things a QA
 * reviewer should see (cut-and-paste notes, vague descriptions,
 * cadence drift, missing best practices, ambiguous next steps, PII).
 *
 * Grouped by `kind` for visual scannability; severity drives the color
 * accent so "warn" items pop.
 */

import { AlertTriangle, Info } from 'lucide-react'

export type AdvisoryKind =
  | 'documentation'
  | 'best_practice'
  | 'cadence'
  | 'process_drift'
  | 'pii'
  | 'other'

export type AdvisorySeverity = 'info' | 'warn'

export interface AdvisoryObservation {
  kind: AdvisoryKind
  severity: AdvisorySeverity
  message: string
  evidence?: string
}

const KIND_LABEL: Record<AdvisoryKind, string> = {
  documentation: 'Documentation',
  best_practice: 'Best practice',
  cadence: 'Cadence',
  process_drift: 'Process drift',
  pii: 'PII',
  other: 'Other',
}

interface Props {
  /** Items as emitted by the AI. Pass an empty array or undefined to skip the section. */
  items: AdvisoryObservation[] | null | undefined
}

export function AdvisoryObservationsPanel({ items }: Props) {
  if (!items || items.length === 0) return null

  // Group by kind, preserving original order within each group.
  const byKind = new Map<AdvisoryKind, AdvisoryObservation[]>()
  for (const o of items) {
    const k = (KIND_LABEL[o.kind] ? o.kind : 'other') as AdvisoryKind
    if (!byKind.has(k)) byKind.set(k, [])
    byKind.get(k)!.push(o)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          <Info className="h-4 w-4 text-primary" /> Advisory observations
        </h2>
        <p className="text-[12px] text-slate-500">
          Non-scored notes from the AI &mdash; cadence, documentation quality, PII, best practices. They don&rsquo;t affect the
          score, but they&rsquo;re worth a look.
        </p>
      </div>
      <div className="p-4 space-y-4">
        {Array.from(byKind.entries()).map(([kind, group]) => (
          <div key={kind}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              {KIND_LABEL[kind]}
            </div>
            <ul className="space-y-1.5">
              {group.map((o, i) => (
                <ObservationRow key={i} o={o} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function ObservationRow({ o }: { o: AdvisoryObservation }) {
  const isWarn = o.severity === 'warn'
  const tone = isWarn
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-slate-200 bg-slate-50 text-slate-800'
  const Icon = isWarn ? AlertTriangle : Info
  return (
    <li className={'flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] leading-snug ' + tone}>
      <Icon className={'h-3.5 w-3.5 shrink-0 mt-0.5 ' + (isWarn ? 'text-amber-600' : 'text-slate-500')} />
      <div className="min-w-0">
        <p>{o.message}</p>
        {o.evidence && (
          <p className="mt-0.5 text-[11px] text-slate-500">
            <span className="font-semibold">Evidence:</span> {o.evidence}
          </p>
        )}
      </div>
    </li>
  )
}

export default AdvisoryObservationsPanel
