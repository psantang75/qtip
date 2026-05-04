/**
 * TimelinePanel — chronological reconstruction the AI Reviewer emits
 * for a single submission. Renders submissions.ai_extras.timeline.
 *
 * Two visual signals:
 *  - rows tied to a documented KB step show the step name as a chip,
 *    so it's obvious at a glance which steps the AI thinks were
 *    completed and which actions fell outside process.
 *  - rows with no kb_step show in muted text — they are the
 *    "non-process" actions (clarifications, customer messages, etc.)
 *    and shouldn't read like a checklist tick.
 *
 * Empty / missing → nothing renders; the parent decides whether to
 * show a placeholder.
 */

import { Clock } from 'lucide-react'

export interface TimelineItem {
  when: string
  who: string
  action: string
  kb_step?: string | null
}

interface Props {
  /** Items as emitted by the AI. Pass an empty array or undefined to skip the section. */
  items: TimelineItem[] | null | undefined
}

export function TimelinePanel({ items }: Props) {
  if (!items || items.length === 0) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-primary" /> Action timeline
        </h2>
        <p className="text-[12px] text-slate-500">
          AI-reconstructed sequence of events tied to the documented KB process. A row with a step chip means the AI judged
          that documented step as completed.
        </p>
      </div>
      <ol className="divide-y divide-slate-100">
        {items.map((item, i) => (
          <li key={i} className="px-4 py-2.5">
            <div className="flex items-start gap-3 text-[12px]">
              <span className="text-slate-500 font-mono whitespace-nowrap shrink-0 w-[110px] truncate" title={item.when}>
                {item.when || '—'}
              </span>
              <span className="text-slate-700 whitespace-nowrap shrink-0 w-[140px] truncate" title={item.who}>
                {item.who || '—'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={item.kb_step ? 'text-slate-800' : 'text-slate-500'}>{item.action}</p>
                {item.kb_step && (
                  <span className="mt-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                    KB step: {item.kb_step}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default TimelinePanel
