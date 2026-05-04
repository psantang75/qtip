/**
 * AI Reviewer per-form management page.
 *
 * Edits guidance, draft mode, and Trusted-mode sampling for one AI-
 * enabled form WITHOUT bumping `forms.version`. All saves go through
 * PATCH /api/ai-reviewer/calibration/forms/:formId/settings.
 *
 * The form-builder still owns the on/off toggle (`ai_enabled`) and
 * everything rubric-related (categories, questions). If a QA admin
 * opens this page for a form that has been deactivated or had AI
 * disabled, we show a redirect-style notice instead of a half-broken
 * editor.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ArrowLeft, Save } from 'lucide-react'
import aiReviewerService from '@/services/aiReviewerService'
import { getFormById } from '@/services/formService'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { PageSpinner } from '@/components/common/PageSpinner'
import { CalibrationMetricsPanel } from './ai-reviewer/CalibrationMetricsPanel'
import { ManualRunCard } from './ai-reviewer/ManualRunCard'
import { ReadinessChip } from './ai-reviewer/ReadinessChip'
import { LearnedCorrectionsPanel } from './ai-reviewer/LearnedCorrectionsPanel'
import { RulePackChipPicker } from './ai-reviewer/RulePackChipPicker'
import { ConfigurationMapCard } from './ai-reviewer/ConfigurationMapCard'
import { PromptPreviewDialog } from './ai-reviewer/PromptPreviewDialog'
import { LatestEvalRunCard } from './ai-reviewer/LatestEvalRunCard'
import { GoldenSetCard } from './ai-reviewer/GoldenSetCard'
import { CalibrationMapPanel } from './ai-reviewer/CalibrationMapPanel'
import { DriftBadge } from './ai-reviewer/DriftBadge'
import { BudgetChip, BudgetGauge } from './ai-reviewer/BudgetGauge'
import { CalibrationMapChip } from './ai-reviewer/CalibrationMapChip'

const LIST_PATH = '/app/quality/ai-reviewer'

export default function AIReviewerFormDetail() {
  const { formId: formIdParam } = useParams<{ formId: string }>()
  const formId = formIdParam ? Number(formIdParam) : NaN
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()

  const formQ = useQuery({
    queryKey: ['ai-reviewer-form', formId],
    queryFn: () => getFormById(formId, true),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  // Local edit state — initialize once per form load. Each save calls
  // PATCH and the response replaces the corresponding draft state so
  // we stay in sync with the server.
  const [guidanceDraft, setGuidanceDraft] = useState<string>('')
  const [submitAsDraft, setSubmitAsDraft] = useState<boolean>(true)
  const [pctDraft, setPctDraft] = useState<number>(10)
  const [lowScoreDraft, setLowScoreDraft] = useState<boolean>(true)
  // Empty string = NULL in DB (low-confidence routing disabled).
  const [lowConfThresholdDraft, setLowConfThresholdDraft] = useState<string>('')
  // Phase 6: per-question kappa floor for disagreement-driven sampling. Empty = off.
  const [disagreementThresholdDraft, setDisagreementThresholdDraft] = useState<string>('')
  // Phase 7b: monthly USD cost ceiling. Empty = unlimited (no budget).
  const [budgetDraft, setBudgetDraft] = useState<string>('')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!formQ.data || hydrated) return
    const f = formQ.data as any
    setGuidanceDraft(f.ai_review_guidance ?? '')
    setSubmitAsDraft(f.ai_submit_as_draft === true)
    setPctDraft(typeof f.ai_sample_review_pct === 'number' ? f.ai_sample_review_pct : 10)
    setLowScoreDraft(f.ai_sample_low_score_always !== false)
    setLowConfThresholdDraft(
      f.ai_sample_low_confidence_threshold == null ? '' : String(Number(f.ai_sample_low_confidence_threshold)),
    )
    setDisagreementThresholdDraft(
      f.ai_disagreement_route_threshold == null ? '' : String(Number(f.ai_disagreement_route_threshold)),
    )
    setBudgetDraft(
      f.ai_monthly_cost_budget_usd == null ? '' : String(Number(f.ai_monthly_cost_budget_usd)),
    )
    setHydrated(true)
  }, [formQ.data, hydrated])

  const settingsMut = useMutation({
    mutationFn: (payload: {
      ai_review_guidance?: string | null
      ai_submit_as_draft?: boolean
      ai_sample_review_pct?: number
      ai_sample_low_score_always?: boolean
      ai_sample_low_confidence_threshold?: number | null
      ai_disagreement_route_threshold?: number | null
      ai_monthly_cost_budget_usd?: number | null
    }) => aiReviewerService.updateCalibrationSettings(formId, payload),
    onSuccess: (data) => {
      if ('ai_review_guidance' in data) setGuidanceDraft(data.ai_review_guidance ?? '')
      if ('ai_submit_as_draft' in data) setSubmitAsDraft(data.ai_submit_as_draft)
      if ('ai_sample_review_pct' in data) setPctDraft(data.ai_sample_review_pct)
      if ('ai_sample_low_score_always' in data) setLowScoreDraft(data.ai_sample_low_score_always)
      if ('ai_sample_low_confidence_threshold' in data) {
        setLowConfThresholdDraft(
          data.ai_sample_low_confidence_threshold == null ? '' : String(Number(data.ai_sample_low_confidence_threshold)),
        )
      }
      if ('ai_disagreement_route_threshold' in (data as any)) {
        const v = (data as any).ai_disagreement_route_threshold
        setDisagreementThresholdDraft(v == null ? '' : String(Number(v)))
      }
      if ('ai_monthly_cost_budget_usd' in (data as any)) {
        const v = (data as any).ai_monthly_cost_budget_usd
        setBudgetDraft(v == null ? '' : String(Number(v)))
      }
      qc.invalidateQueries({ queryKey: ['ai-reviewer-form', formId] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-cost', formId] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-forms'] })
      toast({ title: 'Saved' })
    },
    onError: (e: any) => {
      toast({
        title: 'Save failed',
        description: e?.response?.data?.error ?? e?.message ?? 'Try again',
        variant: 'destructive',
      })
    },
  })

  if (!Number.isFinite(formId) || formId <= 0) {
    return (
      <ListPageShell>
        <ListPageHeader title="AI Reviewer" subtitle="Invalid form id." />
        <Button variant="outline" onClick={() => navigate(LIST_PATH)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to AI Reviewer
        </Button>
      </ListPageShell>
    )
  }

  if (formQ.isLoading) return <PageSpinner />

  if (formQ.isError || !formQ.data) {
    return (
      <ListPageShell>
        <ListPageHeader title="AI Reviewer" subtitle="Could not load this form." />
        <Button variant="outline" onClick={() => navigate(LIST_PATH)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to AI Reviewer
        </Button>
      </ListPageShell>
    )
  }

  const form = formQ.data as any
  const aiEnabled = form.ai_enabled === true

  if (!aiEnabled) {
    return (
      <ListPageShell>
        <ListPageHeader
          title={form.form_name ?? `Form ${formId}`}
          subtitle="This form does not have AI Reviewer enabled."
        />
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          To manage AI settings, open this form in Form Builder and toggle <strong>Enable AI Reviewer</strong> on the Details tab. Once saved, it will appear here.
        </div>
        <Button variant="outline" onClick={() => navigate(LIST_PATH)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to AI Reviewer
        </Button>
      </ListPageShell>
    )
  }

  const modeDirty = submitAsDraft !== (form.ai_submit_as_draft === true)
  const guidanceDirty = guidanceDraft !== (form.ai_review_guidance ?? '')
  const currentThresholdStr =
    form.ai_sample_low_confidence_threshold == null
      ? ''
      : String(Number(form.ai_sample_low_confidence_threshold))
  const currentDisagreementStr =
    form.ai_disagreement_route_threshold == null
      ? ''
      : String(Number(form.ai_disagreement_route_threshold))
  const currentBudgetStr =
    form.ai_monthly_cost_budget_usd == null
      ? ''
      : String(Number(form.ai_monthly_cost_budget_usd))
  const samplingDirty =
    pctDraft !== (typeof form.ai_sample_review_pct === 'number' ? form.ai_sample_review_pct : 10) ||
    lowScoreDraft !== (form.ai_sample_low_score_always !== false) ||
    lowConfThresholdDraft.trim() !== currentThresholdStr ||
    disagreementThresholdDraft.trim() !== currentDisagreementStr ||
    budgetDraft.trim() !== currentBudgetStr
  const anyDirty = modeDirty || guidanceDirty || samplingDirty

  const criticalCap =
    typeof form.critical_cap_percent === 'number' && Number.isFinite(form.critical_cap_percent)
      ? form.critical_cap_percent
      : 79

  const saveAll = () => {
    const payload: {
      ai_review_guidance?: string | null
      ai_submit_as_draft?: boolean
      ai_sample_review_pct?: number
      ai_sample_low_score_always?: boolean
      ai_sample_low_confidence_threshold?: number | null
      ai_disagreement_route_threshold?: number | null
      ai_monthly_cost_budget_usd?: number | null
    } = {}
    if (modeDirty) payload.ai_submit_as_draft = submitAsDraft
    if (guidanceDirty) payload.ai_review_guidance = guidanceDraft.trim() === '' ? null : guidanceDraft
    if (samplingDirty) {
      payload.ai_sample_review_pct = pctDraft
      payload.ai_sample_low_score_always = lowScoreDraft
      const trimmed = lowConfThresholdDraft.trim()
      if (trimmed === '') {
        payload.ai_sample_low_confidence_threshold = null
      } else {
        const n = Number(trimmed)
        if (Number.isFinite(n) && n >= 0 && n <= 1) {
          payload.ai_sample_low_confidence_threshold = n
        }
      }
      const dTrimmed = disagreementThresholdDraft.trim()
      if (dTrimmed === '') {
        payload.ai_disagreement_route_threshold = null
      } else {
        const n = Number(dTrimmed)
        if (Number.isFinite(n) && n >= 0 && n <= 1) {
          payload.ai_disagreement_route_threshold = n
        }
      }
      const bTrimmed = budgetDraft.trim()
      if (bTrimmed === '') {
        payload.ai_monthly_cost_budget_usd = null
      } else {
        const n = Number(bTrimmed)
        if (Number.isFinite(n) && n >= 0) {
          payload.ai_monthly_cost_budget_usd = Math.round(n * 100) / 100
        }
      }
    }
    if (Object.keys(payload).length === 0) return
    settingsMut.mutate(payload)
  }

  return (
    <ListPageShell>
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(LIST_PATH)}
            className="text-[12px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> AI Reviewer
          </button>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" /> {form.form_name}
            {/* Smoke signal #2 — visible chip pinning the prompt revision the
                UI was built against. Mismatch with backend startup log
                means the deploy is half-complete. */}
            <span
              className="ml-1 inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600"
              title="AI Reviewer prompt revision shipping with this UI"
            >
              prompt v2.0
            </span>
          </h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            v{form.version} · {form.interaction_type ?? '—'} · Edits here do not bump the form version.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PromptPreviewDialog formId={formId} />
          <span
            className={
              'text-[11px] font-semibold px-2 py-0.5 rounded-full border ' +
              (submitAsDraft
                ? 'text-amber-700 bg-amber-50 border-amber-200'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200')
            }
          >
            {submitAsDraft ? 'Calibrating' : 'Trusted'}
          </span>
          <ReadinessChip formId={formId} />
          <CalibrationMapChip formId={formId} />
          <DriftBadge formId={formId} />
          <BudgetChip formId={formId} />
        </div>
      </div>

      {/* ── Configuration map (where to change what) ─────────────────── */}
      <ConfigurationMapCard />

      {/* ── Manual training run ──────────────────────────────────────── */}
      <ManualRunCard formId={formId} />

      {/* ── Rule pack assignment ─────────────────────────────────────── */}
      <RulePackChipPicker formId={formId} />

      {/* ── Settings card ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-slate-900">Settings</h2>
            <p className="text-[12px] text-slate-500">Edits here apply in place and do not create a new form version.</p>
          </div>
          <Button
            size="sm"
            onClick={saveAll}
            disabled={!anyDirty || settingsMut.isPending}
            className="bg-primary hover:bg-primary/90 text-white"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            {settingsMut.isPending ? 'Saving…' : anyDirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>

        <div className="p-4 space-y-6">
          {/* Mode toggle */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <Label className="text-[13px] font-medium text-slate-800">Save AI submissions as DRAFT for human approval</Label>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {submitAsDraft
                  ? 'Calibrating: AI submissions wait in the AI Inbox until a QA reviewer promotes them. Promotions feed the rolling agreement.'
                  : 'Trusted: AI submissions go straight to SUBMITTED + scored. A sample is routed back to the AI Inbox for re-audit (configured below).'}
              </p>
            </div>
            <Switch checked={submitAsDraft} onCheckedChange={setSubmitAsDraft} />
          </div>

          {/* Guidance */}
          <div className="space-y-1.5">
            <Label htmlFor="guidance" className="text-[13px] font-medium text-slate-800">
              AI Reviewer Guidance
              <span className="ml-2 text-[11px] font-normal text-slate-400">
                (extra grading rules for this form — applied alongside the built-in rules)
              </span>
            </Label>
            <textarea
              id="guidance"
              value={guidanceDraft}
              onChange={(e) => setGuidanceDraft(e.target.value)}
              rows={6}
              placeholder={'e.g. "Mark a step NA only when the agent has explicitly noted that the issue resolved before reaching it, or that the step was not applicable. NA without supporting note text should be graded as No."'}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 leading-snug focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <p className="text-[11px] text-slate-500">
              Plain English. The AI applies these rules with the same weight as the built-in grading philosophy.
            </p>
          </div>

          {/* Sampling */}
          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-[13px] font-medium text-slate-800 mb-1">Trusted-mode sampling</h3>
            <p className="text-[12px] text-slate-500 mb-3">
              Only used when the form is in <span className="font-medium">Trusted</span> mode (above toggle off). A portion
              of AI-graded submissions is routed back to the AI Inbox so a human can re-audit them and feed the rolling
              agreement number.
            </p>
            <div className="space-y-4 max-w-md">
              <div>
                <Label htmlFor="pct" className="text-[11px] text-slate-600">
                  Random sample percentage: <span className="font-mono">{pctDraft}%</span>
                  <span className="ml-2 text-slate-400">— how often a SUBMITTED AI submission is randomly picked for human re-audit</span>
                </Label>
                <Input
                  id="pct"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={pctDraft}
                  onChange={(e) => setPctDraft(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="lowscore" className="text-[12px] text-slate-700">
                    Always re-audit submissions below the critical-fail cap
                  </Label>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    On top of the random sample above, force a re-audit any time the AI's score lands below the form's
                    Critical Fail Cap (currently <span className="font-mono">{criticalCap}%</span>, set on the form's
                    Details tab). Catches the AI being too generous on weak interactions.
                  </p>
                </div>
                <Switch id="lowscore" checked={lowScoreDraft} onCheckedChange={setLowScoreDraft} />
              </div>

              <div>
                <Label htmlFor="lowconf" className="text-[12px] text-slate-700">
                  Low-confidence routing threshold
                  <span className="ml-2 text-[11px] font-normal text-slate-400">(0.00&ndash;1.00, blank = off)</span>
                </Label>
                <p className="text-[11px] text-slate-500 mt-0.5 mb-1.5">
                  When the AI emits an <span className="font-mono">overall_confidence</span> below this number, the submission
                  is automatically routed to the QA inbox &mdash; even if it wasn&rsquo;t in the random sample. Use this to
                  shrink human review effort to the runs the AI itself was unsure about.
                </p>
                <Input
                  id="lowconf"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={lowConfThresholdDraft}
                  onChange={(e) => setLowConfThresholdDraft(e.target.value)}
                  placeholder="e.g. 0.7"
                  className="max-w-[160px]"
                />
              </div>

              <div>
                <Label htmlFor="disagreethr" className="text-[12px] text-slate-700">
                  Per-question disagreement route threshold
                  <span className="ml-2 text-[11px] font-normal text-slate-400">(Cohen&rsquo;s &kappa; 0.00&ndash;1.00, blank = off)</span>
                </Label>
                <p className="text-[11px] text-slate-500 mt-0.5 mb-1.5">
                  Routes a submission to QA when any one of its answers is on a question whose rolling per-question
                  &kappa; (last 50 calibration data points) is below this floor. Useful for catching individual questions
                  the AI is consistently wrong on, even when its overall confidence looks fine. Try <span className="font-mono">0.4</span>{' '}
                  to start.
                </p>
                <Input
                  id="disagreethr"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={disagreementThresholdDraft}
                  onChange={(e) => setDisagreementThresholdDraft(e.target.value)}
                  placeholder="e.g. 0.4"
                  className="max-w-[160px]"
                />
              </div>
            </div>
          </div>

          {/* Cost budget */}
          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-[13px] font-medium text-slate-800 mb-1">Monthly cost budget</h3>
            <p className="text-[12px] text-slate-500 mb-3">
              Cap the monthly USD spend on AI Reviewer calls for this form. We soft-warn at 80% (yellow gauge) and
              hard-block at 100% &mdash; submissions over the cap are routed straight to a human reviewer until the
              UTC month rolls over. Leave blank for no budget.
            </p>
            <div className="space-y-2 max-w-md">
              <div>
                <Label htmlFor="budget" className="text-[12px] text-slate-700">
                  Monthly cap (USD)
                  <span className="ml-2 text-[11px] font-normal text-slate-400">(blank = unlimited)</span>
                </Label>
                <Input
                  id="budget"
                  type="number"
                  min={0}
                  step={1}
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                  placeholder="e.g. 50"
                  className="max-w-[160px]"
                />
              </div>
              <BudgetGauge formId={formId} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Closed-loop visibility: what corrections are being injected ── */}
      <LearnedCorrectionsPanel formId={formId} />

      {/* ── Golden-set regression eval ─────────────────────────────────── */}
      <LatestEvalRunCard formId={formId} />
      <GoldenSetCard formId={formId} />

      {/* ── Empirical confidence calibration ─────────────────────────── */}
      <CalibrationMapPanel formId={formId} />

      {/* ── Calibration metrics ──────────────────────────────────────── */}
      <CalibrationMetricsPanel formId={formId} />
    </ListPageShell>
  )
}
