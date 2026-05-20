/**
 * Layer 1 of the 4-layer prompt model: the universal Base prompt.
 *
 * Read-only on this card. Editing happens in the Base Prompt Library
 * (Admin-only). Shows:
 *   - The Base prompt's name and current version chip.
 *   - A collapsible body preview of the assembled Base text (Base body
 *     + the single-source addendum that the runtime appends in code).
 *   - An "Edit in library" link (Admin-only).
 *
 * The Base prompt is universal — every form on every department uses
 * the same Base body. The previous per-form picker was retired in
 * 20260515090000; the only way to change the Base is via the Library.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileText, Pencil } from 'lucide-react'
import aiReviewerService from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface Props {
  formId: number
}

export function BasePromptCard({ formId }: Props) {
  const [open, setOpen] = useState(false)
  const isAdmin = useIsAdmin()

  // Resolved prompt sections for the form (gives us the assembled Base
  // text and its char count without a second round-trip when rendering
  // the collapsed-body preview).
  const previewQ = useQuery({
    queryKey: ['ai-reviewer-prompt-preview', formId],
    queryFn: () => aiReviewerService.getPromptPreview(formId),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  // The single Base prompt row (kind='base'). Used for the version chip
  // and the deep-link target. There is exactly one non-archived row.
  const baseQ = useQuery({
    queryKey: ['ai-reviewer-base-prompts', 'base'],
    queryFn: () => aiReviewerService.listBasePrompts({ kind: 'base' }),
    staleTime: 60 * 1000,
  })

  const activeBase = (baseQ.data ?? []).find((b) => b.is_default && !b.is_archived) ?? (baseQ.data ?? [])[0] ?? null

  const baseText = previewQ.data?.sections.system_base.text ?? ''
  const baseChars = previewQ.data?.sections.system_base.chars ?? 0

  const editHref = activeBase?.id
    ? `/app/quality/ai-reviewer/base-prompts?base=${activeBase.id}`
    : '/app/quality/ai-reviewer/base-prompts'

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-start gap-2 text-left hover:opacity-80"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-slate-500 mt-0.5" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500 mt-0.5" />
          )}
          <div>
            <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-primary" /> Base prompt
              {activeBase && (
                <span className="ml-1 inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                  {activeBase.key}
                  {activeBase.current_version != null ? ` v${activeBase.current_version}` : ''}
                </span>
              )}
            </h2>
            <p className="text-[12px] text-slate-500">
              The universal grading rules every AI review starts from. Common to every form, every department. Edited
              in the Base Prompt Library by Admins.
            </p>
          </div>
        </button>
        <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap pt-1">
          {baseChars.toLocaleString()} chars
        </span>
      </div>

      {isAdmin && (
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-end">
          <Button asChild size="sm" variant="outline">
            <Link to={editHref}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit in library
            </Link>
          </Button>
        </div>
      )}

      {open && (
        <div className="p-4">
          {previewQ.isLoading ? (
            <div className="text-[13px] text-slate-500">Loading…</div>
          ) : previewQ.error ? (
            <div className="text-[13px] text-rose-600">Failed to load: {(previewQ.error as Error).message}</div>
          ) : !baseText ? (
            <div className="text-[13px] text-slate-500">Base text unavailable.</div>
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-slate-900 text-slate-100 p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
              {baseText}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}
