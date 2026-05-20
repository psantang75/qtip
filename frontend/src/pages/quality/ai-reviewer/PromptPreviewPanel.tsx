/**
 * Inline panel rendering the composed system prompt for the form's next
 * AI run, broken down by section with char counts and an approximate
 * token estimate.
 *
 * Same data source as `PromptPreviewDialog` — both surfaces render this
 * component so there's one source of truth for the breakdown layout.
 *
 * `mode="inline"` (default) auto-loads on mount and is used in the
 * AI Prompt tab. `mode="dialog"` defers to the parent to trigger the
 * fetch (the dialog only loads on open) and skips the empty-state.
 */

import { useQuery } from '@tanstack/react-query'
import aiReviewerService from '@/services/aiReviewerService'

interface Props {
  formId: number
  /** When 'dialog', the panel does not auto-fetch on mount. */
  mode?: 'inline' | 'dialog'
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}KB`
  return `${n}c`
}

export function PromptPreviewPanel({ formId, mode = 'inline' }: Props) {
  const previewQ = useQuery({
    queryKey: ['ai-reviewer-prompt-preview', formId],
    queryFn: () => aiReviewerService.getPromptPreview(formId),
    enabled: mode === 'inline' && Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  if (previewQ.isLoading || previewQ.isFetching) {
    return <div className="text-[13px] text-slate-500 py-6">Loading…</div>
  }
  if (previewQ.error) {
    return (
      <div className="text-[13px] text-rose-600 py-6">
        Failed to load: {(previewQ.error as Error).message}
      </div>
    )
  }
  if (!previewQ.data) {
    return mode === 'dialog' ? (
      <div className="text-[13px] text-slate-500 py-6">Click Preview prompt to load.</div>
    ) : null
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-semibold text-slate-700">Total system prompt</span>
          <span className="text-[12px] font-mono text-slate-800">
            {formatChars(previewQ.data.total_chars)} · ~{previewQ.data.approx_tokens.toLocaleString()} tokens
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
          <SectionRow label="Universal base" chars={previewQ.data.sections.system_base.chars} />
          <SectionRow label="Rule packs" chars={previewQ.data.sections.rule_packs.chars} />
          <SectionRow label="Per-form guidance" chars={previewQ.data.sections.per_form_guidance.chars} />
          <SectionRow
            label={`Corrections (${previewQ.data.sections.learned_corrections.items})`}
            chars={previewQ.data.sections.learned_corrections.chars}
          />
        </div>
        <p className="text-[10px] text-slate-500 pt-1 italic">{previewQ.data.note}</p>
      </div>

      <div className="flex flex-col">
        <div className="text-[12px] font-semibold text-slate-700 mb-1.5">Full system prompt</div>
        <pre className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-slate-900 text-slate-100 p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
          {previewQ.data.system_prompt_full}
        </pre>
      </div>
    </div>
  )
}

function SectionRow({ label, chars }: { label: string; chars: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-800">{formatChars(chars)}</span>
    </div>
  )
}
