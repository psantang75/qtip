/**
 * AnswerEvidencePanel (Phase C, C6) — surfaces the per-answer
 * `evidence_source` / `evidence_quote` pairs the AI Reviewer emits in
 * `submissions.ai_extras.answer_evidence`. One row per question, with
 * the verbatim quote underneath the source label.
 *
 * Shows nothing when no evidence has been recorded, so human-authored
 * submissions don't grow an empty section.
 *
 * Pairs with TimelinePanel (chronological narrative) and the existing
 * ScoreRenderer (which renders the answer text itself). This panel
 * exists separately so the answer-level evidence trail is visible
 * without rewiring the score renderer.
 */

import { Quote } from 'lucide-react'

export interface AnswerEvidenceEntry {
  question_id: number
  question_text?: string | null
  evidence_source?: string | null
  evidence_quote?: string | null
}

interface Props {
  items: AnswerEvidenceEntry[] | null | undefined
}

export function AnswerEvidencePanel({ items }: Props) {
  const rows = (items ?? []).filter(
    (it) => Boolean(it.evidence_source) || Boolean(it.evidence_quote)
  )
  if (rows.length === 0) return null

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          <Quote className="h-4 w-4 text-primary" /> Per-answer evidence
        </h2>
        <p className="text-[12px] text-slate-500">
          Where the AI looked when grading each question, plus the
          verbatim snippet that justified the answer.
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((it) => (
          <li key={it.question_id} className="px-4 py-3 text-[12px]">
            <div className="text-slate-800 font-medium">
              {it.question_text || `Question #${it.question_id}`}
            </div>
            {it.evidence_source && (
              <div className="mt-1 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                {it.evidence_source}
              </div>
            )}
            {it.evidence_quote && (
              <p className="mt-1.5 text-slate-700 italic border-l-2 border-slate-200 pl-2">
                &ldquo;{it.evidence_quote}&rdquo;
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default AnswerEvidencePanel
