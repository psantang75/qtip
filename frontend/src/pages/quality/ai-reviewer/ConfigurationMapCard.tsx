/**
 * Configuration map card for the AI Reviewer detail page.
 *
 * A single source of truth that tells QA admins WHERE to change WHAT.
 * Without this, settings are scattered: form rubric in Form Builder,
 * AI guidance + sampling here, rule pack BODIES in git, calibration
 * thresholds in code.
 *
 * Static content — no data fetching. Update this card any time a new
 * setting moves between surfaces.
 */

import { Map as MapIcon } from 'lucide-react'

const ROWS: Array<{ what: string; where: string; how: string }> = [
  {
    what: 'Form rubric (categories, questions, weights)',
    where: 'Form Builder',
    how: 'Edit the form via Form Builder. Saving creates a new form version.',
  },
  {
    what: 'AI on/off (ai_enabled)',
    where: 'Form Builder · Details tab',
    how: '"Enable AI Reviewer" toggle. Off-on requires re-saving the form.',
  },
  {
    what: 'AI Reviewer Guidance (per-form free text)',
    where: 'AI Reviewer · this page · Settings card',
    how: 'In-place save. Does not bump the form version.',
  },
  {
    what: 'Rule packs (reusable grading rules)',
    where: 'Pick: AI Reviewer · this page · Rule Packs card. Edit pack BODY: backend/prompts/rule-packs/*.md.',
    how: 'Picker writes backend/config/ai-form-rule-packs.json. Body edits require a backend restart to pick up.',
  },
  {
    what: 'Calibrating ↔ Trusted mode',
    where: 'AI Reviewer · this page · Settings · "Save AI submissions as DRAFT…" toggle',
    how: 'In-place save. Manual transition.',
  },
  {
    what: 'Trusted-mode random sample %',
    where: 'AI Reviewer · this page · Settings · Trusted-mode sampling',
    how: 'Slider 0–100%. Always-low-score toggle on by default.',
  },
  {
    what: 'Trusted-mode low-confidence routing threshold',
    where: 'AI Reviewer · this page · Settings · Trusted-mode sampling',
    how: 'Number 0.00–1.00 (NULL disables). Routes runs whose overall_confidence falls below the value to the QA inbox.',
  },
  {
    what: 'AI provider keys / model selection',
    where: 'backend/.env (ANTHROPIC_API_KEY, OPENAI_API_KEY) and backend/src/config/ai.ts',
    how: 'Backend restart required.',
  },
  {
    what: 'KB grounding (BookStack URL, depth, semantic index)',
    where: 'backend/.env (BOOKSTACK_*) and backend/src/services/AIReviewerService.ts (searchKb)',
    how: 'Backend restart required.',
  },
]

export function ConfigurationMapCard() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          <MapIcon className="h-4 w-4 text-primary" /> Configuration map
        </h2>
        <p className="text-[12px] text-slate-500">
          Where every AI Reviewer setting lives. Bookmark this — there is no other &ldquo;control panel&rdquo;.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Setting</th>
              <th className="px-4 py-2 font-semibold">Where to change it</th>
              <th className="px-4 py-2 font-semibold">How saves apply</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ROWS.map((row, i) => (
              <tr key={i} className="align-top">
                <td className="px-4 py-2 font-medium text-slate-800 w-[28%]">{row.what}</td>
                <td className="px-4 py-2 text-slate-700">{row.where}</td>
                <td className="px-4 py-2 text-slate-600">{row.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default ConfigurationMapCard
