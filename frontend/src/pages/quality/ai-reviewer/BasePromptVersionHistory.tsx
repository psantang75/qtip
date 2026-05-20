/**
 * Version history drawer for a single base prompt. Lists every saved
 * version newest-first with its change_note, the body diff against the
 * current version, and a Rollback button.
 *
 * Rollback creates a NEW version row whose body is a copy of the
 * selected one, so the timeline reads forward-only and history is never
 * erased. The current version becomes vN+1; the selected old row stays
 * exactly where it is.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Loader2, RotateCcw } from 'lucide-react'
import aiReviewerService, {
  type BasePromptDetail,
  type BasePromptVersion,
} from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'

interface Props {
  open: boolean
  base: BasePromptDetail | null
  onClose: () => void
  onRolledBack: () => void
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function BasePromptVersionHistory({ open, base, onClose, onRolledBack }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [selectedVersion, setSelectedVersion] = useState<BasePromptVersion | null>(null)

  const historyQ = useQuery({
    queryKey: ['ai-reviewer-base-prompt-history', base?.id],
    queryFn: () => aiReviewerService.getBasePromptHistory(base!.id, 50),
    enabled: open && base != null,
    staleTime: 30 * 1000,
  })

  const rollbackMut = useMutation({
    mutationFn: (versionId: number) =>
      aiReviewerService.rollbackBasePrompt(base!.id, versionId),
    onSuccess: (next) => {
      toast({
        title: 'Rolled back',
        description: `Now on v${next.current_version}. The previous version is preserved in history.`,
      })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-base-prompts'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-base-prompt-history', base!.id] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-prompt-preview'] })
      setSelectedVersion(null)
      onRolledBack()
    },
    onError: (e: any) =>
      toast({
        title: 'Rollback failed',
        description: e?.response?.data?.error ?? e?.message,
        variant: 'destructive',
      }),
  })

  // The "current" body to diff against = the body the parent passed in.
  const currentBody = base?.body ?? ''
  const currentVersion = base?.current_version ?? null

  const versions = useMemo(() => historyQ.data ?? [], [historyQ.data])

  function handleConfirmRollback(v: BasePromptVersion) {
    if (!base) return
    const ok = window.confirm(
      `Rollback "${base.name}" to v${v.version} (${fmtDate(v.created_at)})?\n\n` +
        `This will create a NEW version (v${(currentVersion ?? 0) + 1}) with v${v.version}'s body. ` +
        `The current text will remain in history.`,
    )
    if (!ok) return
    rollbackMut.mutate(v.id)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Version history{base ? ` — ${base.name}` : ''}
          </SheetTitle>
          <SheetDescription>
            Every save is a new row. Rollback creates another new row whose body is a copy of the selected version,
            so the timeline reads forward-only and you never lose history.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {historyQ.isLoading && (
            <div className="flex items-center gap-2 text-sm text-neutral-700">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
            </div>
          )}

          {!historyQ.isLoading && versions.length === 0 && (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-neutral-700">
              No history yet.
            </div>
          )}

          {versions.map((v) => {
            const isCurrent = v.version === currentVersion
            const isSelected = selectedVersion?.id === v.id
            return (
              <div
                key={v.id}
                className={
                  'rounded-lg border p-3 ' +
                  (isCurrent
                    ? 'border-primary bg-primary/5'
                    : isSelected
                      ? 'border-slate-400 bg-slate-50'
                      : 'border-slate-200 bg-white')
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-neutral-900">v{v.version}</span>
                      {isCurrent && (
                        <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                          Current
                        </span>
                      )}
                      <span className="text-xs text-neutral-700">{fmtDate(v.created_at)}</span>
                    </div>
                    {v.change_note && (
                      <p className="mt-1 text-xs text-neutral-700 italic">"{v.change_note}"</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedVersion(isSelected ? null : v)}
                    >
                      {isSelected ? 'Hide' : 'Preview'}
                    </Button>
                    {!isCurrent && (
                      <Button
                        size="sm"
                        onClick={() => handleConfirmRollback(v)}
                        disabled={rollbackMut.isPending}
                        className="bg-primary text-white hover:bg-primary/90"
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Rollback
                      </Button>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <pre className="mt-3 max-h-[40vh] overflow-auto rounded-md border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100 whitespace-pre-wrap">
                    {v.body_md}
                  </pre>
                )}

                {isSelected && !isCurrent && currentBody && (
                  <p className="mt-2 text-[11px] text-neutral-700">
                    Length diff vs. current: {v.body_md.length.toLocaleString()} chars (this version) vs.{' '}
                    {currentBody.length.toLocaleString()} chars (current).
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
