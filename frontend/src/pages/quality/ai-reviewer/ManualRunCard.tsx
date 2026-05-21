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
import { Loader2, PlayCircle, ExternalLink, Plus, X, AlertTriangle, GitCompareArrows } from 'lucide-react'
import aiReviewerService, {
  type ManualRunKind,
  type ManualRunAttachedSource,
  type ManualRunResult,
} from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  canRunManual,
  nextAttachedDefault,
  trimAttachedSources,
} from './manualRunCardState'

interface Props {
  formId: number
  /**
   * Phase C (C6): per-form cap on attached sources surfaced from
   * `forms.ai_max_attached_sources`. The page that hosts this card
   * may not have the form column wired through yet, in which case we
   * fall back to the schema default (3). Backend enforces the cap
   * authoritatively, so the UI value is purely a guardrail.
   */
  maxAttachedSources?: number
}

/**
 * Conservative default that matches `forms.ai_max_attached_sources`'
 * Prisma default (3) — used when the host page hasn't passed an
 * explicit cap. Keeping this in sync is the ManualRunCard's only
 * coupling to the form schema.
 */
const DEFAULT_MAX_ATTACHED_SOURCES = 3

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

export function ManualRunCard({ formId, maxAttachedSources }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [kind, setKind] = useState<ManualRunKind>('TICKET')
  const [externalId, setExternalId] = useState<string>('')
  const [lastResult, setLastResult] = useState<ManualRunResult | null>(null)
  // Compare-models state: when the user fires "Run Both", we capture
  // both per-provider results here so the result strip can render the
  // side-by-side panel (Claude vs ChatGPT — submission id, score,
  // wall-clock time, cost) in a single place beneath the run button.
  // null means "no compare run since last mutation".
  const [compareResults, setCompareResults] = useState<{
    anthropic?: ManualRunResult
    openai?: ManualRunResult
    anthropicError?: { message: string; code: string | null }
    openaiError?: { message: string; code: string | null }
  } | null>(null)
  // Tier-compare state: same shape as compareResults but keyed by
  // model tier (DEFAULT = Opus, ALT = Sonnet — both Anthropic). Fired
  // by the "Compare Sonnet vs Opus" button. Mutually exclusive with
  // compareResults so the result strip below the buttons always
  // reflects exactly one experiment.
  const [compareTierResults, setCompareTierResults] = useState<{
    default?: ManualRunResult
    alt?: ManualRunResult
    defaultError?: { message: string; code: string | null }
    altError?: { message: string; code: string | null }
  } | null>(null)
  // Persistent inline copy of the most recent failure. The toast still
  // fires (and disappears after a few seconds), but a manual run can
  // take 60–120s — by the time the spinner stops, the user has often
  // tabbed away and missed the toast entirely. This strip stays put
  // until they dismiss it or kick off a new run.
  const [lastError, setLastError] = useState<{ message: string; code: string | null } | null>(null)
  // Phase C (C6): attached sources for multi-source manual runs (e.g.
  // ticket primary + linked call). Empty array preserves the legacy
  // single-source request body byte-identically.
  const [attached, setAttached] = useState<ManualRunAttachedSource[]>([])

  const cap = Math.max(0, Math.min(10, maxAttachedSources ?? DEFAULT_MAX_ATTACHED_SOURCES))
  const canAttachMore = attached.length < cap

  const updateAttached = (idx: number, patch: Partial<ManualRunAttachedSource>) => {
    setAttached((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }
  const removeAttached = (idx: number) => {
    setAttached((prev) => prev.filter((_, i) => i !== idx))
  }
  const addAttached = () => {
    if (!canAttachMore) return
    setAttached((prev) => [...prev, { kind: nextAttachedDefault(kind), external_id: '' }])
  }

  // Only send rows that have a non-empty id. We don't auto-trim on
  // every keystroke (the user may legitimately have whitespace in a
  // conversation id mid-paste), but we trim at submit time.
  const trimmedAttached = trimAttachedSources(attached)

  const mut = useMutation({
    mutationFn: () =>
      aiReviewerService.runManual(formId, kind, externalId.trim(), trimmedAttached),
    onMutate: () => {
      // Clear any prior result/error so the strip below the button always
      // reflects the run the user is currently waiting on.
      setLastResult(null)
      setLastError(null)
      setCompareResults(null)
      setCompareTierResults(null)
    },
    onSuccess: (data) => {
      setLastResult(data)
      setLastError(null)
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
      // Backend AI Reviewer routes return { error, code } — surface the
      // code in the inline strip so operators can recognise repeat issues
      // (e.g. INTERACTION_NOT_CLOSED) without digging through server logs.
      const code = e?.response?.data?.code ?? null
      setLastError({ message: desc, code: typeof code === 'string' ? code : null })
      toast({ title: 'Run failed', description: desc, variant: 'destructive' })
    },
  })

  // Compare-models mutation: fires two parallel /run calls — one pinned
  // to Anthropic, one pinned to OpenAI. Settles even when ONE side
  // fails (e.g. OpenAI not configured) so the user still sees the
  // working side's result. Multi-source only — the backend rejects
  // OPENAI provider on the single-source path.
  const compareMut = useMutation({
    mutationFn: async () => {
      const tasks: Array<Promise<{ key: 'anthropic' | 'openai'; value: ManualRunResult } | { key: 'anthropic' | 'openai'; error: { message: string; code: string | null } }>> = (
        ['anthropic', 'openai'] as const
      ).map(async (key) => {
        try {
          const value = await aiReviewerService.runManual(
            formId,
            kind,
            externalId.trim(),
            trimmedAttached,
            key,
          )
          return { key, value }
        } catch (e: any) {
          const raw = e?.response?.data?.error
          const message =
            typeof raw === 'string'
              ? raw
              : raw?.message
              ? String(raw.message)
              : e?.message
              ? String(e.message)
              : 'Run failed'
          const code = e?.response?.data?.code ?? null
          return { key, error: { message, code: typeof code === 'string' ? code : null } }
        }
      })
      const settled = await Promise.all(tasks)
      const out: NonNullable<typeof compareResults> = {}
      for (const item of settled) {
        if ('value' in item) {
          if (item.key === 'anthropic') out.anthropic = item.value
          else out.openai = item.value
        } else {
          if (item.key === 'anthropic') out.anthropicError = item.error
          else out.openaiError = item.error
        }
      }
      return out
    },
    onMutate: () => {
      setLastResult(null)
      setLastError(null)
      setCompareResults(null)
      setCompareTierResults(null)
    },
    onSuccess: (data) => {
      setCompareResults(data)
      qc.invalidateQueries({ queryKey: ['ai-reviewer-inbox'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-forms'] })
      const sides = [
        data.anthropic ? 'Claude' : null,
        data.openai ? 'ChatGPT' : null,
      ].filter(Boolean)
      toast({
        title: sides.length === 2 ? 'Compare run complete' : `Compare run finished (${sides.join(', ')} succeeded)`,
        description: 'Open each draft below to inspect the answers side-by-side.',
      })
    },
  })

  // Tier-compare mutation: fires two parallel Anthropic /run calls,
  // one with model_tier=default (Opus) and one with model_tier=alt
  // (Sonnet). Same settle-when-one-fails shape as the cross-provider
  // compare; same multi-source-only constraint (backend rejects the
  // model_tier override on the single-source path). Lets the user
  // diff Sonnet's accuracy + cost against Opus on the SAME case
  // without touching .env or the form column.
  const compareTierMut = useMutation({
    mutationFn: async () => {
      const tasks: Array<
        Promise<
          | { key: 'default' | 'alt'; value: ManualRunResult }
          | { key: 'default' | 'alt'; error: { message: string; code: string | null } }
        >
      > = (['default', 'alt'] as const).map(async (tier) => {
        try {
          const value = await aiReviewerService.runManual(
            formId,
            kind,
            externalId.trim(),
            trimmedAttached,
            'anthropic',
            tier,
          )
          return { key: tier, value }
        } catch (e: any) {
          const raw = e?.response?.data?.error
          const message =
            typeof raw === 'string'
              ? raw
              : raw?.message
              ? String(raw.message)
              : e?.message
              ? String(e.message)
              : 'Run failed'
          const code = e?.response?.data?.code ?? null
          return { key: tier, error: { message, code: typeof code === 'string' ? code : null } }
        }
      })
      const settled = await Promise.all(tasks)
      const out: NonNullable<typeof compareTierResults> = {}
      for (const item of settled) {
        if ('value' in item) {
          if (item.key === 'default') out.default = item.value
          else out.alt = item.value
        } else {
          if (item.key === 'default') out.defaultError = item.error
          else out.altError = item.error
        }
      }
      return out
    },
    onMutate: () => {
      setLastResult(null)
      setLastError(null)
      setCompareResults(null)
      setCompareTierResults(null)
    },
    onSuccess: (data) => {
      setCompareTierResults(data)
      qc.invalidateQueries({ queryKey: ['ai-reviewer-inbox'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-forms'] })
      const sides = [
        data.default ? 'Opus' : null,
        data.alt ? 'Sonnet' : null,
      ].filter(Boolean)
      toast({
        title:
          sides.length === 2
            ? 'Sonnet vs Opus compare complete'
            : `Sonnet vs Opus compare finished (${sides.join(', ')} succeeded)`,
        description: 'Open each draft below to inspect the answers side-by-side.',
      })
    },
  })

  const selectedOpt = KIND_OPTIONS.find((o) => o.kind === kind) ?? KIND_OPTIONS[0]
  const anyPending = mut.isPending || compareMut.isPending || compareTierMut.isPending
  const canRun = !anyPending && canRunManual(externalId, attached)
  // Both compare buttons require attached_sources (multi-source path)
  // because the single-source synthesis path doesn't honour the
  // provider OR model_tier overrides. Surface this in the disabled
  // state + tooltip so the user doesn't fire a doomed run.
  const canCompare = canRun && trimmedAttached.length > 0
  const canCompareTier = canCompare
  const compareDisabledReason = !canRun
    ? undefined
    : trimmedAttached.length === 0
    ? 'Compare requires at least one attached source (multi-source path).'
    : undefined
  const compareTierDisabledReason = compareDisabledReason

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
        {/* Interaction — primary source plus any optional attached sources.
            Primary and attached rows share the same kind-picker + id-input
            layout so the form reads as one consistent list. */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[12px] font-medium text-slate-700">Interaction</Label>
            <span className="text-[11px] text-slate-500">
              {attached.length}/{cap} attached
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Pick the ticket, task, or conversation to grade. Add more sources to grade them
            together as a single case (e.g. confirm ticket notes match the call).
          </p>

          <div className="mt-2 space-y-2">
            {/* Primary interaction row — same layout as attached sources, no remove button */}
            <div
              className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2"
              data-testid="manual-run-primary"
            >
              <div className="flex flex-wrap items-center gap-1.5">
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
              <div className="flex-1">
                <Input
                  id="manual-run-id"
                  aria-label={kind === 'CONVERSATION' ? 'Conversation ID' : `${selectedOpt.label} ID`}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder={selectedOpt.placeholder}
                  disabled={mut.isPending}
                  autoComplete="off"
                />
              </div>
              {/* Spacer to keep the primary input aligned with attached rows
                  (which reserve a 7×7 slot for the remove button). */}
              <div className="hidden sm:block h-7 w-7 shrink-0" aria-hidden="true" />
            </div>

            {attached.map((row, idx) => {
              const rowOpt = KIND_OPTIONS.find((o) => o.kind === row.kind) ?? KIND_OPTIONS[0]
              return (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2"
                  data-testid={`manual-run-attached-${idx}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {KIND_OPTIONS.map((opt) => (
                      <button
                        key={opt.kind}
                        type="button"
                        disabled={mut.isPending}
                        onClick={() => updateAttached(idx, { kind: opt.kind })}
                        className={cn(
                          'h-7 px-3 text-[12px] rounded border font-medium transition-all',
                          optionCls(row.kind === opt.kind),
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1">
                    <Input
                      aria-label={`Attached source ${idx + 1} ID`}
                      value={row.external_id}
                      onChange={(e) => updateAttached(idx, { external_id: e.target.value })}
                      placeholder={rowOpt.placeholder}
                      disabled={mut.isPending}
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttached(idx)}
                    disabled={mut.isPending}
                    aria-label={`Remove attached source ${idx + 1}`}
                    className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded text-slate-500 hover:text-destructive hover:bg-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addAttached}
            disabled={!canAttachMore || mut.isPending}
            className="mt-2 h-7 text-[12px]"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add source
          </Button>
        </div>

        {/* Run buttons — single-provider Run + two side-by-side compares.
            The compare buttons are only enabled on the multi-source path
            (the single-source synthesis honours neither the provider nor
            the model_tier override). */}
        <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => compareTierMut.mutate()}
            disabled={!canCompareTier || anyPending}
            title={compareTierDisabledReason}
            className="sm:w-auto w-full"
          >
            {compareTierMut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Comparing Sonnet vs Opus… 90–240s
              </>
            ) : (
              <>
                <GitCompareArrows className="h-3.5 w-3.5 mr-1.5" />
                Compare Sonnet vs Opus
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => compareMut.mutate()}
            disabled={!canCompare || anyPending}
            title={compareDisabledReason}
            className="sm:w-auto w-full"
          >
            {compareMut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Comparing Claude vs ChatGPT… 60–180s
              </>
            ) : (
              <>
                <GitCompareArrows className="h-3.5 w-3.5 mr-1.5" />
                Run Both (Compare)
              </>
            )}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!canRun}
            className="bg-primary hover:bg-primary/90 text-white sm:w-auto w-full"
          >
            {mut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {trimmedAttached.length > 0
                  ? 'Running multi-source review… this can take 60–120s'
                  : 'Running… this can take 30–60s'}
              </>
            ) : (
              <>
                <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
                Run
              </>
            )}
          </Button>
        </div>

        {/* Error strip — persists until dismissed or replaced by a new run.
            Mirrors the success strip's shape so the eye lands in the same
            place regardless of outcome. */}
        {lastError && (
          <div
            className="rounded-md border border-red-200 bg-red-50 text-red-900 px-3 py-2 text-[12px] flex items-start justify-between gap-3"
            role="alert"
            data-testid="manual-run-error"
          >
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">Run failed</div>
                <div className="text-red-800 break-words">{lastError.message}</div>
                {lastError.code && (
                  <div className="mt-0.5 text-[11px] font-mono text-red-700/80">
                    {lastError.code}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLastError(null)}
              aria-label="Dismiss error"
              className="h-6 w-6 inline-flex items-center justify-center rounded text-red-700 hover:bg-white/60 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Compare result panel — side-by-side Claude vs ChatGPT. Renders
            in place of the single-result strip so the visual real estate
            stays bounded. Each side shows submission id, score, provider,
            cost, wall-clock time + "Open draft" link in a new tab so
            both can be opened and visually diffed against each other. */}
        {compareResults && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="manual-run-compare-results">
            {(['anthropic', 'openai'] as const).map((key) => {
              const r = compareResults[key]
              const err = key === 'anthropic' ? compareResults.anthropicError : compareResults.openaiError
              const sideLabel = key === 'anthropic' ? 'Claude (Anthropic)' : 'ChatGPT (OpenAI)'
              const link =
                r == null
                  ? null
                  : r.status === 'DRAFT'
                  ? `/app/quality/audit?promoteDraft=${r.submission_id}`
                  : `/app/quality/submissions/${r.submission_id}`
              const sec =
                r?.elapsed_ms != null ? `${(r.elapsed_ms / 1000).toFixed(1)}s` : null

              if (err) {
                return (
                  <div
                    key={key}
                    className="rounded-md border border-red-200 bg-red-50 text-red-900 px-3 py-2 text-[12px]"
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {sideLabel} — failed
                    </div>
                    <div className="text-red-800 break-words mt-0.5">{err.message}</div>
                    {err.code && (
                      <div className="mt-0.5 text-[11px] font-mono text-red-700/80">{err.code}</div>
                    )}
                  </div>
                )
              }
              if (!r || !link) return null
              return (
                <div
                  key={key}
                  className={cn(
                    'rounded-md border px-3 py-2 text-[12px]',
                    r.status === 'DRAFT'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{sideLabel}</div>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[11px] font-medium hover:bg-white/50"
                    >
                      Open draft
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="mt-1 text-slate-700 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      {r.status === 'DRAFT'
                        ? `DRAFT #${r.submission_id}`
                        : `Submitted #${r.submission_id} (score ${r.total_score})`}
                    </span>
                    {sec && <span className="font-mono text-slate-600">{sec}</span>}
                    {r.cost_estimate && (
                      <span className="font-mono text-slate-600">
                        {r.cost_estimate.formatted}
                        {r.cost_estimate.approximated ? ' (approx)' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Tier compare result panel — Sonnet vs Opus. Same shape as the
            cross-provider compare panel above, but each card labels by
            the resolved Anthropic model name returned by the backend
            (resolved_reasoning_model) so the user can see at a glance
            which lane is which without reading code. */}
        {compareTierResults && (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            data-testid="manual-run-compare-tier-results"
          >
            {(['default', 'alt'] as const).map((tier) => {
              const r = compareTierResults[tier]
              const err =
                tier === 'default'
                  ? compareTierResults.defaultError
                  : compareTierResults.altError
              const tierBase = tier === 'default' ? 'Opus (default)' : 'Sonnet (alt)'
              const resolvedModel = r?.resolved_reasoning_model
              const sideLabel = resolvedModel ? `${tierBase} — ${resolvedModel}` : tierBase
              const link =
                r == null
                  ? null
                  : r.status === 'DRAFT'
                  ? `/app/quality/audit?promoteDraft=${r.submission_id}`
                  : `/app/quality/submissions/${r.submission_id}`
              const sec =
                r?.elapsed_ms != null ? `${(r.elapsed_ms / 1000).toFixed(1)}s` : null

              if (err) {
                return (
                  <div
                    key={tier}
                    className="rounded-md border border-red-200 bg-red-50 text-red-900 px-3 py-2 text-[12px]"
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {sideLabel} — failed
                    </div>
                    <div className="text-red-800 break-words mt-0.5">{err.message}</div>
                    {err.code && (
                      <div className="mt-0.5 text-[11px] font-mono text-red-700/80">{err.code}</div>
                    )}
                  </div>
                )
              }
              if (!r || !link) return null
              return (
                <div
                  key={tier}
                  className={cn(
                    'rounded-md border px-3 py-2 text-[12px]',
                    r.status === 'DRAFT'
                      ? 'border-amber-200 bg-amber-50 text-amber-900'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-900',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{sideLabel}</div>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[11px] font-medium hover:bg-white/50"
                    >
                      Open draft
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="mt-1 text-slate-700 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      {r.status === 'DRAFT'
                        ? `DRAFT #${r.submission_id}`
                        : `Submitted #${r.submission_id} (score ${r.total_score})`}
                    </span>
                    {sec && <span className="font-mono text-slate-600">{sec}</span>}
                    {r.cost_estimate && (
                      <span className="font-mono text-slate-600">
                        {r.cost_estimate.formatted}
                        {r.cost_estimate.approximated ? ' (approx)' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

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
