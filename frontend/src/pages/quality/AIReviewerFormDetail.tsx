/**
 * AI Reviewer per-form management page.
 *
 * Tabs:
 *   - Manual Run        → ManualRunCard
 *   - AI Prompt         → 4 sections that shape the prompt the AI sees
 *                          (Universal base, Rule packs, Per-form guidance,
 *                          Per-question rubrics) + Learned corrections +
 *                          the compiled-prompt viewer
 *   - Quality & Calibration → eval / golden-set / calibration
 *   - Settings          → submission mode, sampling, budget
 *   - Diagnostics       → KB coverage
 *
 * Each settings sub-card owns its own dirty state and Save button via
 * `useAISettingsMutation`, so switching tabs mid-edit does not leak.
 *
 * The form-builder still owns the on/off toggle (`ai_enabled`) and
 * everything rubric-related (categories, questions). If a QA admin
 * opens this page for a form that has been deactivated or had AI
 * disabled, we show a redirect-style notice instead of a half-broken
 * editor.
 */

import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bot, ArrowLeft } from 'lucide-react'
import { getFormById } from '@/services/formService'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { PageSpinner } from '@/components/common/PageSpinner'
import { CalibrationMetricsPanel } from './ai-reviewer/CalibrationMetricsPanel'
import { ManualRunCard } from './ai-reviewer/ManualRunCard'
import { ReadinessChip } from './ai-reviewer/ReadinessChip'
import { LearnedCorrectionsPanel } from './ai-reviewer/LearnedCorrectionsPanel'
import { RulePackChipPicker } from './ai-reviewer/RulePackChipPicker'
import { LatestEvalRunCard } from './ai-reviewer/LatestEvalRunCard'
import { GoldenSetCard } from './ai-reviewer/GoldenSetCard'
import { CalibrationMapPanel } from './ai-reviewer/CalibrationMapPanel'
import { KbCoverageCard } from './ai-reviewer/KbCoverageCard'
import { QuestionRubricsCard } from './ai-reviewer/QuestionRubricsCard'
import { DriftBadge } from './ai-reviewer/DriftBadge'
import { BudgetChip } from './ai-reviewer/BudgetGauge'
import { CalibrationMapChip } from './ai-reviewer/CalibrationMapChip'
import { ModeToggleCard } from './ai-reviewer/ModeToggleCard'
import { ModelProviderCard } from './ai-reviewer/ModelProviderCard'
import { SamplingCard } from './ai-reviewer/SamplingCard'
import { BudgetCard } from './ai-reviewer/BudgetCard'
import { GuidanceRulesCard } from './ai-reviewer/GuidanceRulesCard'
import { BasePromptCard } from './ai-reviewer/BasePromptCard'
import { PromptBuildingBlocksHeader } from './ai-reviewer/PromptBuildingBlocksHeader'
import { PromptPreviewPanel } from './ai-reviewer/PromptPreviewPanel'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { Lock } from 'lucide-react'

const LIST_PATH = '/app/quality/ai-reviewer'

/**
 * Wraps a section card with a small absolutely-positioned numeric badge
 * that maps the card to its building block in `PromptBuildingBlocksHeader`.
 * The badge sits on the top-left corner so it doesn't fight with each
 * card's existing chevron/title; relative positioning lets each card
 * keep its own internal layout intact.
 */
function NumberedSectionWrapper({ num, children }: { num: number; children: ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute -top-2 -left-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-primary bg-white text-primary text-[12px] font-semibold shadow-sm"
      >
        {num}
      </span>
      {children}
    </div>
  )
}

export default function AIReviewerFormDetail() {
  const { formId: formIdParam } = useParams<{ formId: string }>()
  const formId = formIdParam ? Number(formIdParam) : NaN
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  const formQ = useQuery({
    queryKey: ['ai-reviewer-form', formId],
    queryFn: () => getFormById(formId, true),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
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

  const form = formQ.data
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

  const submitAsDraft = form.ai_submit_as_draft === true
  const initialPct = typeof form.ai_sample_review_pct === 'number' ? form.ai_sample_review_pct : 10
  const initialLowScoreAlways = form.ai_sample_low_score_always !== false
  const initialLowConfThreshold =
    form.ai_sample_low_confidence_threshold == null ? null : Number(form.ai_sample_low_confidence_threshold)
  const initialDisagreementThreshold =
    form.ai_disagreement_route_threshold == null ? null : Number(form.ai_disagreement_route_threshold)
  const initialBudget =
    form.ai_monthly_cost_budget_usd == null ? null : Number(form.ai_monthly_cost_budget_usd)
  const initialGuidanceText = form.ai_review_guidance ?? ''
  const criticalCap =
    typeof form.critical_cap_percent === 'number' && Number.isFinite(form.critical_cap_percent)
      ? form.critical_cap_percent
      : 79
  const initialProvider: 'anthropic' | 'openai' =
    form.ai_model_provider === 'openai' ? 'openai' : 'anthropic'

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

      <Tabs defaultValue="manual-run" className="space-y-4">
        <TabsList>
          <TabsTrigger value="manual-run">Manual Run</TabsTrigger>
          <TabsTrigger value="ai-prompt">AI Prompt</TabsTrigger>
          <TabsTrigger value="quality">Quality &amp; Calibration</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="manual-run" className="space-y-4">
          <ManualRunCard formId={formId} />
        </TabsContent>

        <TabsContent value="ai-prompt" className="space-y-4">
          {!isAdmin && <AdminOnlyEditsBadge />}

          {/* Numbered explainer that maps the four building blocks below to
              their scope and owner. Numbers match the badges on each card. */}
          <PromptBuildingBlocksHeader />

          {/* The four authored building blocks — rendered in the same order
              they are concatenated at runtime by previewSystemPrompt(). An
              admin reading top-to-bottom sees the prompt build up exactly the
              way the model receives it. */}
          <NumberedSectionWrapper num={1}>
            <BasePromptCard formId={formId} />
          </NumberedSectionWrapper>
          <NumberedSectionWrapper num={2}>
            <RulePackChipPicker formId={formId} />
          </NumberedSectionWrapper>
          <NumberedSectionWrapper num={3}>
            <GuidanceRulesCard formId={formId} initialGuidanceText={initialGuidanceText} />
          </NumberedSectionWrapper>
          {formQ.data && (
            <NumberedSectionWrapper num={4}>
              <QuestionRubricsCard form={formQ.data} />
            </NumberedSectionWrapper>
          )}

          {/* Auto-applied (not authored). Visually grouped beneath the four
              building blocks so admins know it's a different category — they
              do not write these; the system harvests them from QA
              corrections. */}
          <div className="pt-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 px-1 pb-2">
              Auto-applied (not authored)
            </h3>
            <LearnedCorrectionsPanel formId={formId} />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-[14px] font-semibold text-slate-900">Compiled prompt</h2>
              <p className="text-[12px] text-slate-500">
                What the AI sees, top-to-bottom: 1 + 2 + 3 + 4 + corrections. The user prompt (ticket-specific data) is
                omitted because it changes every run.
              </p>
            </div>
            <div className="p-4">
              <PromptPreviewPanel formId={formId} mode="inline" />
            </div>
          </section>
        </TabsContent>

        <TabsContent value="quality" className="space-y-4">
          {/* ── Golden-set regression eval ────────────────────────── */}
          <LatestEvalRunCard formId={formId} />
          <GoldenSetCard formId={formId} />

          {/* ── Empirical confidence calibration ──────────────────── */}
          <CalibrationMapPanel formId={formId} />

          {/* ── Calibration metrics ───────────────────────────────── */}
          <CalibrationMetricsPanel formId={formId} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {!isAdmin && <AdminOnlyEditsBadge />}
          <ModeToggleCard formId={formId} initialSubmitAsDraft={submitAsDraft} />
          <ModelProviderCard formId={formId} initialProvider={initialProvider} />
          <SamplingCard
            formId={formId}
            initialPct={initialPct}
            initialLowScoreAlways={initialLowScoreAlways}
            initialLowConfThreshold={initialLowConfThreshold}
            initialDisagreementThreshold={initialDisagreementThreshold}
            criticalCap={criticalCap}
          />
          <BudgetCard formId={formId} initialBudget={initialBudget} />
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
          {/* ── KB coverage by pivot (Tier-2 Item 4) ──────────────── */}
          <KbCoverageCard formId={formId} />
        </TabsContent>
      </Tabs>
    </ListPageShell>
  )
}

/**
 * Inline notice rendered at the top of the AI Prompt and Settings tabs
 * when the viewer is not an Admin. Save buttons on every card are also
 * disabled (with `title="Admin only"`) so the user gets feedback at the
 * point of attempted action — this banner just prevents the "why are
 * the buttons greyed out?" confusion.
 */
function AdminOnlyEditsBadge() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] text-neutral-700">
      <Lock className="h-3.5 w-3.5 text-neutral-700" />
      <span>
        <span className="font-medium">Edits restricted to Admin.</span> You can view every setting and prompt section,
        but only Admins can save changes here.
      </span>
    </div>
  )
}
