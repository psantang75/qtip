/**
 * "Run AI manually" card on the AI Reviewer per-form management page.
 *
 * Lets a QA admin grade an individual ticket / task / conversation with
 * the form's AI Reviewer, on demand, without any developer involvement.
 * Used for calibration runs, training sessions, and one-off audits.
 *
 * Design conformance:
 *   - Kind picker uses the same segmented-button pattern that
 *     YES_NO / RADIO / MULTI_SELECT questions use across the platform
 *     (see `formRendererComponents.tsx#optionCls`). No raw <input
 *     type="radio">, no custom shadows, no new color tokens.
 *   - Buttons / Input / Label come from `components/ui/*` (shadcn).
 *   - Result strip uses success / warning tints matching the
 *     `--color-success` and `--color-warning` palette in
 *     `docs/design.md`.
 *
 * Result lands either in the AI Inbox as a DRAFT (Calibrating mode)
 * or as a SUBMITTED submission (Trusted mode) — the deep-link button
 * adapts to the returned status so the reviewer can act on it
 * immediately.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, PlayCircle, ExternalLink } from 'lucide-react'
import aiReviewerService, {
  type ManualRunKind,
  type ManualRunResult,
} from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface Props {
  formId: number
}

interface KindOption {
  kind: ManualRunKind
  label: string
  placeholder: string
}

const KIND_OPTIONS: KindOption[] = [
  { kind: 'TICKET', label: 'Ticket', placeholder: 'e.g. 279046' },
  { kind: 'TASK', label: 'Task', placeholder: 'e.g. 12345' },
  { kind: 'CONVERSATION', label: 'Conversation', placeholder: 'e.g. 6f3a8c1e-…' },
]

// Same selected/unselected style the runtime audit form uses for its
// YES_NO / RADIO / MULTI_SELECT pills. Keeping the visual language
// identical so this picker doesn't feel like a one-off control.
const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]'

export function ManualRunCard({ formId }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [kind, setKind] = useState<ManualRunKind>('TICKET')
  const [externalId, setExternalId] = useState<string>('')
  const [lastResult, setLastResult] = useState<ManualRunResult | null>(null)

  const mut = useMutation({
    mutationFn: () => aiReviewerService.runManual(formId, kind, externalId.trim()),
    onSuccess: (data) => {
      setLastResult(data)
      qc.invalidateQueries({ queryKey: ['ai-calibration-metrics', formId] })
      qc.invalidateQueries({ queryKey: ['ai-calibration-recent', formId] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-inbox'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-forms'] })
      // TEMP COST ESTIMATOR — append the per-run USD cost to the toast so
      // operators see real cost-per-review during calibration. Removed when
      // we wire real usage analytics.
      const costSuffix = data.cost_estimate
        ? ` · TEMP COST ESTIMATOR: ${data.cost_estimate.formatted}${data.cost_estimate.approximated ? ' (approx)' : ''}`
        : ''
      toast({
        title: data.status === 'DRAFT' ? 'AI draft created' : 'AI submission saved',
        description:
          (data.status === 'DRAFT'
            ? 'Open the draft to review and promote it.'
            : `Score ${data.total_score}. Open the submission to view it.`) + costSuffix,
      })
    },
    onError: (e: any) => {
      // Server error payloads come in two flavours across our routes:
      //   { error: 'string' }          — the AI Reviewer routes
      //   { error: { message: '...' } }— the global error middleware
      // Normalize to a string so the toast never gets an object as a
      // child (which crashes React).
      const raw = e?.response?.data?.error
      const desc =
        typeof raw === 'string'
          ? raw
          : raw?.message
          ? String(raw.message)
          : e?.message
          ? String(e.message)
          : 'AI run failed'
      toast({ title: 'Run failed', description: desc, variant: 'destructive' })
    },
  })

  const selectedOpt = KIND_OPTIONS.find((o) => o.kind === kind) ?? KIND_OPTIONS[0]
  const canRun = !mut.isPending && externalId.trim().length > 0

  const resultLink =
    lastResult == null
      ? null
      : lastResult.status === 'DRAFT'
      ? `/app/quality/audit?promoteDraft=${lastResult.submission_id}`
      : `/app/quality/submissions/${lastResult.submission_id}`

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[14px] font-semibold text-slate-900">Run AI manually</h2>
        <p className="text-[12px] text-slate-500">
          Pick an interaction and run this form's AI Reviewer against it. Useful for training,
          calibration, or one-off audits.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Kind picker — segmented buttons, matches YES_NO question style */}
        <div>
          <Label className="text-[12px] font-medium text-slate-700">Interaction kind</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.kind}
                type="button"
                disabled={mut.isPending}
                onClick={() => setKind(opt.kind)}
                className={cn(
                  'h-7 px-3 text-[12px] rounded border font-medium transition-all',
                  optionCls(kind === opt.kind),
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ID input + Run button */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="manual-run-id" className="text-[12px] font-medium text-slate-700">
              {kind === 'CONVERSATION' ? 'Conversation ID' : `${selectedOpt.label} ID`}
            </Label>
            <Input
              id="manual-run-id"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder={selectedOpt.placeholder}
              disabled={mut.isPending}
              autoComplete="off"
            />
          </div>
          <Button
            onClick={() => mut.mutate()}
            disabled={!canRun}
            className="bg-primary hover:bg-primary/90 text-white sm:w-auto w-full"
          >
            {mut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Running… this can take 30–60s
              </>
            ) : (
              <>
                <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
                Run
              </>
            )}
          </Button>
        </div>

        {/* Result strip */}
        {lastResult && resultLink && (
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-[12px] flex items-center justify-between gap-3',
              lastResult.status === 'DRAFT'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900',
            )}
          >
            <div>
              <span className="font-semibold">
                {lastResult.status === 'DRAFT'
                  ? 'DRAFT created'
                  : `Submitted (score ${lastResult.total_score})`}
              </span>
              <span className="ml-2 text-slate-600">submission #{lastResult.submission_id}</span>
              {lastResult.cost_estimate && (
                <span className="ml-2 text-slate-500 font-mono">
                  TEMP COST ESTIMATOR: {lastResult.cost_estimate.formatted}
                  {lastResult.cost_estimate.approximated ? ' (approx)' : ''}
                </span>
              )}
            </div>
            <a
              href={resultLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-1 text-[11px] font-medium hover:bg-white/50"
            >
              {lastResult.status === 'DRAFT' ? 'Review draft' : 'Open submission'}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </section>
  )
}

export default ManualRunCard
