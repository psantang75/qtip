/**
 * Diagnostic dialog: "Show me what the AI sees."
 *
 * Renders the composed system prompt for the form's next AI run, broken
 * down by section with char counts and an approximate token estimate.
 * This is the highest-leverage tool for catching prompt bloat (rule packs
 * stacking up, per-form guidance creeping past the 2000-char cap, learned
 * corrections accumulating beyond the budget) before it shows up as cost
 * or latency drift in production.
 */

import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import aiReviewerService from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Props {
  formId: number
}

function formatChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}KB`
  return `${n}c`
}

export function PromptPreviewDialog({ formId }: Props) {
  const previewQ = useQuery({
    queryKey: ['ai-reviewer-prompt-preview', formId],
    queryFn: () => aiReviewerService.getPromptPreview(formId),
    enabled: false,
  })

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={() => previewQ.refetch()}
          className="text-[12px]"
          title="See the exact system prompt the AI will receive on the next run for this form"
        >
          <Eye className="h-3.5 w-3.5 mr-1" />
          Preview prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>System prompt preview</DialogTitle>
          <DialogDescription>
            What the AI Reviewer will see in its system message on the next run for this form. Break-down by section
            shows where prompt size is coming from. The user prompt (ticket-specific data) is omitted because it changes
            every run.
          </DialogDescription>
        </DialogHeader>

        {previewQ.isLoading || previewQ.isFetching ? (
          <div className="text-[13px] text-slate-500 py-6">Loading…</div>
        ) : previewQ.error ? (
          <div className="text-[13px] text-rose-600 py-6">Failed to load: {(previewQ.error as Error).message}</div>
        ) : previewQ.data ? (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {/* Size breakdown */}
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

            {/* Full prompt */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="text-[12px] font-semibold text-slate-700 mb-1.5">Full system prompt</div>
              <pre className="flex-1 overflow-auto rounded-md border border-slate-200 bg-slate-900 text-slate-100 p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                {previewQ.data.system_prompt_full}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-slate-500 py-6">Click Preview prompt to load.</div>
        )}
      </DialogContent>
    </Dialog>
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
