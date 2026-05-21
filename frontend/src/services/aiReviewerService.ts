/**
 * Frontend client for /api/ai-reviewer/* endpoints.
 *
 * Mirrors the route layer in backend/src/routes/ai-reviewer.routes.ts.
 * Update both sides together when shapes change.
 */

import { api } from './authService'

export interface AiInboxItem {
  submission_id: number
  form_id: number
  form_name: string
  /**
   * Phase C (C4): `<KIND>:<external_id>` identifier shared by every
   * submission belonging to the same multi-source case (ticket+call).
   * `source_label` is the pre-formatted human label for the row.
   */
  case_id: string | null
  source_label: string
  ticket_id: number | null
  created_at: string | null
  total_score: number | null
}

export interface AiInboxSampleItem extends AiInboxItem {
  routing_reason: 'low_score' | 'low_confidence' | 'low_question_agreement' | 'random_sample'
  ai_overall_confidence: number | null
}

export interface AiInbox {
  drafts_awaiting_promotion: AiInboxItem[]
  samples_awaiting_review: AiInboxSampleItem[]
}

export interface PromoteDraftPayload {
  answers: Array<{ question_id: number; answer: string; notes?: string }>
  metadata?: Array<{ field_id: number | string; value: string }>
  /**
   * Free-text "Why are you correcting the AI?" the reviewer typed.
   * Persisted to ai_calibration_data.notes and surfaced as a "Reviewer's
   * reason" bullet in future AI runs to close the calibration loop.
   */
  correction_reason?: string | null
}

export interface AiDraftDetail {
  submission_id: number
  form_id: number
  form_name: string | null
  submitted_at: string | null
  ai_overall_confidence: number | null
  ai_extras: AiExtras | null
  answers: Array<{
    question_id: number
    answer: string
    notes: string
    ai_confidence: number | null
  }>
  metadata: Array<{ field_id: number; value: string }>
  ticket_tasks: Array<{ kind: 'TICKET' | 'TASK'; external_id: number }>
  // Multi-source attached calls (Phase C). Mirrors the read-only
  // SubmissionCall shape consumed by CallDetailsPanel so the audit page
  // can hand the same data through without remapping.
  calls?: Array<{
    id: number
    call_id: string
    csr_id: number
    customer_id: string | null
    call_date: string
    duration: number
    recording_url: string | null
    transcript: string | null
  }>
}

export interface AiExtras {
  timeline?: Array<{ when: string; who: string; action: string; kb_step?: string | null }>
  observations?: Array<{
    kind: 'documentation' | 'best_practice' | 'cadence' | 'process_drift' | 'pii' | 'other'
    severity: 'info' | 'warn'
    message: string
    evidence?: string
  }>
}

export interface CalibrationMetrics {
  form_id: number
  window_size: number
  sample_count: number
  oldest_in_window_at: string | null
  /** @deprecated Use overall_kappa for chance-corrected agreement. */
  overall_agreement: number | null
  overall_kappa: number | null
  per_question_agreement: Array<{
    question_id: number
    /** @deprecated Use kappa */
    agreement: number
    kappa: number | null
    n: number
  }>
  last_30d_count: number
  drift_compare: {
    window_size: number
    sample_count: number
    /** @deprecated Use overall_kappa */
    overall_agreement: number | null
    overall_kappa?: number | null
  } | null
}

export interface CalibrationDataPoint {
  id: number
  created_at: string
  form_id: number
  ticket_id: number
  source: 'qa_promoted_draft' | 'qa_sample_review'
  ai_submission_id: number | null
  human_submission_id: number | null
  ai_answers: Record<string, string> | null
  human_answers: Record<string, string>
  graded_by: number | null
  in_rolling_set: boolean
  notes: string | null
}

export interface CalibrationSettings {
  id: number
  ai_enabled: boolean
  ai_review_guidance: string | null
  ai_submit_as_draft: boolean
  ai_sample_review_pct: number
  ai_sample_low_score_always: boolean
  ai_sample_low_confidence_threshold: number | null
  /** Phase 6: kappa floor; rows with any question kappa below this route to QA. */
  ai_disagreement_route_threshold: number | null
  /** Phase 7b: monthly USD budget cap (null = unlimited). */
  ai_monthly_cost_budget_usd: number | null
}

export type ManualRunKind = 'TICKET' | 'TASK' | 'CONVERSATION'

/**
 * Phase C (C6): one entry in `runManual`'s optional `attachedSources`
 * list. The route layer renames CONVERSATION → CALL on the way in;
 * the UI keeps the user-facing CONVERSATION label so the segmented
 * picker stays consistent with the primary `kind` selector.
 */
export interface ManualRunAttachedSource {
  kind: ManualRunKind
  external_id: string
}

export interface ManualRunResult {
  submission_id: number
  status: 'DRAFT' | 'SUBMITTED'
  total_score: number
  message: string
  ai_model: string
  kb_pages_cited: Array<{ id: number; name: string; url: string }>
  /**
   * TEMP COST ESTIMATOR — non-persistent USD cost estimate. Will be
   * removed when we wire up real usage analytics.
   */
  cost_estimate?: { usd: number; formatted: string; approximated: boolean } | null
  /**
   * Provider that handled the synthesis pipeline for this run. Returned
   * by the backend so the compare-models UI can label which side a
   * given submission came from without re-querying the form.
   */
  provider?: 'anthropic' | 'openai'
  /** Wall-clock latency for the manual run, in milliseconds. */
  elapsed_ms?: number
  /**
   * Resolved reasoning + verification model for THIS run. Surfaced only
   * when the caller passed `model_tier='alt'` (the Sonnet-vs-Opus
   * compare button) — lets the UI label each compare card by the
   * actual model name without re-querying `ai_call_logs`. Absent on
   * default runs.
   */
  resolved_reasoning_model?: string
}

export type ModeReadinessRecommendation =
  | 'PROMOTE_TO_TRUSTED'
  | 'STAY_CALIBRATING'
  | 'CONSIDER_DEMOTE'
  | 'INSUFFICIENT_DATA'

export interface ModeReadiness {
  recommendation: ModeReadinessRecommendation
  /** @deprecated Use rolling_kappa */
  rolling_agreement: number | null
  rolling_kappa: number | null
  sample_count: number
  last_30d_count: number
  current_mode: 'CALIBRATING' | 'TRUSTED'
  thresholds: {
    promote_kappa: number
    promote_min_samples: number
    demote_kappa: number
    demote_min_30d_samples: number
    /** @deprecated */
    promote_agreement: number
    /** @deprecated */
    demote_agreement: number
  }
}

export interface AiFormSummary {
  id: number
  form_name: string
  interaction_type: string
  version: number
  is_active: boolean
  ai_review_guidance: string | null
  ai_submit_as_draft: boolean
  ai_sample_review_pct: number
  ai_sample_low_score_always: boolean
  ai_sample_low_confidence_threshold: number | null
  ai_disagreement_route_threshold: number | null
  ai_monthly_cost_budget_usd: number | null
  overall_agreement: number | null
  sample_count: number
  last_30d_count: number
  readiness: ModeReadiness | null
}

export interface CalibrationCorrection {
  question_id: number
  question_text: string
  ai_value: string
  human_value: string
  ticket_id: number
  source: 'qa_promoted_draft' | 'qa_sample_review'
  created_at: string
  data_point_id: number
  /** Free-text "Why are you correcting the AI?" the reviewer typed during promote/overlay. */
  correction_reason?: string | null
}

export interface AbsorbedCorrection extends CalibrationCorrection {
  absorbed_at: string
  absorbed_reason: string | null
}

export interface RulePackSummary {
  key: string
  name: string
  owner_dept: string
}

export interface PromptPreview {
  form_id: number
  /**
   * Which runtime pipeline this preview reflects. Always 'single_source'
   * today (the most common path); the same Base body is also used by
   * the multi-source synthesis pass with a different addendum.
   */
  assembled_for: 'single_source'
  sections: {
    // `text` is only present on `system_base` — see the route comment for
    // why other sections are char-only.
    system_base: { chars: number; text?: string }
    rule_packs: { chars: number }
    per_form_guidance: { chars: number }
    learned_corrections: { chars: number; items: number }
  }
  total_chars: number
  approx_tokens: number
  system_prompt_full: string
  note: string
}

// ── Cost guard (Phase 7b) ────────────────────────────────────────────
export interface CostStatus {
  allowed: boolean
  warn: boolean
  mtdUsd: number
  budgetUsd: number | null
  reason: string
}

// ── Drift detection (Phase 7a) ───────────────────────────────────────
export type DriftMetricKey =
  | 'avg_score'
  | 'avg_nominal_confidence'
  | 'avg_calibrated_confidence'
  | 'score_variance'

export interface DriftSnapshot {
  date: string
  submissions: number
  avg_score: number | null
  avg_nominal_confidence: number | null
  avg_calibrated_confidence: number | null
  score_variance: number | null
}

export interface DriftAlert {
  metric: DriftMetricKey
  today: number
  baseline_mean: number
  baseline_sd: number
  z_score: number
}

export interface DriftStatus {
  form_id: number
  latest: DriftSnapshot | null
  baseline: Partial<Record<DriftMetricKey, { mean: number; sd: number; n: number }>>
  alerts: DriftAlert[]
  history: DriftSnapshot[]
}

const aiReviewerService = {
  getInbox: () => api.get<AiInbox>('/ai-reviewer/inbox').then((r) => r.data),

  getDraft: (submissionId: number) =>
    api.get<AiDraftDetail>(`/ai-reviewer/draft/${submissionId}`).then((r) => r.data),

  promoteDraft: (submissionId: number, payload: PromoteDraftPayload) =>
    api.post(`/ai-reviewer/promote-draft/${submissionId}`, payload).then((r) => r.data),

  recordCalibrationOverlay: (aiSubmissionId: number, payload: PromoteDraftPayload) =>
    api.post(`/ai-reviewer/calibration-overlay/${aiSubmissionId}`, payload).then((r) => r.data),

  // ── Calibration tab ──────────────────────────────────────────────────
  getCalibrationMetrics: (formId: number, windowSize = 50) =>
    api
      .get<CalibrationMetrics>(`/ai-reviewer/calibration/forms/${formId}/metrics?window=${windowSize}`)
      .then((r) => r.data),

  getCalibrationRecent: (formId: number, limit = 20) =>
    api
      .get<{ items: CalibrationDataPoint[] }>(`/ai-reviewer/calibration/forms/${formId}/recent?limit=${limit}`)
      .then((r) => r.data.items),

  updateCalibrationSettings: (
    formId: number,
    payload: Partial<
      Pick<
        CalibrationSettings,
        | 'ai_review_guidance'
        | 'ai_submit_as_draft'
        | 'ai_sample_review_pct'
        | 'ai_sample_low_score_always'
        | 'ai_sample_low_confidence_threshold'
        | 'ai_disagreement_route_threshold'
        | 'ai_monthly_cost_budget_usd'
      >
    >,
  ) => api.patch<CalibrationSettings>(`/ai-reviewer/calibration/forms/${formId}/settings`, payload).then((r) => r.data),

  listAiForms: () =>
    api.get<{ items: AiFormSummary[] }>('/ai-reviewer/forms').then((r) => r.data.items),

  getModeReadiness: (formId: number) =>
    api.get<ModeReadiness>(`/ai-reviewer/forms/${formId}/readiness`).then((r) => r.data),

  getCorrectionsPreview: (formId: number) =>
    api
      .get<{ items: CalibrationCorrection[] }>(`/ai-reviewer/forms/${formId}/corrections-preview`)
      .then((r) => r.data.items),

  // ── Manual run ───────────────────────────────────────────────────────
  // 720s (12-min) timeout: a multi-source manual run on a LARGE form (e.g.
  // form 99018, Contact Call Review v2 AI Pilot, ~114 questions) requires
  // the synthesis pass to emit ~16k output tokens, which Opus 4.7 streams
  // at ~2-3k tokens/min. Combined with KB link expansion + per-source
  // traces + an outer JSON-parse retry, the production-path budget is
  // ~10 min of LLM wall time. The backend's per-call Anthropic timeout
  // is 600s on the synthesis call (callClaude in AIReviewerService.ts);
  // 720s here gives a small buffer over that so a slow Opus run still
  // surfaces the BACKEND's clean error message ("Claude failed to return
  // valid JSON"...) instead of axios timing out first and leaving the
  // user with the misleading "Network Error" toast. Smaller forms still
  // finish in ~30-90s; the bigger ceiling costs the UI nothing in the
  // common case.
  runManual: (
    formId: number,
    kind: ManualRunKind,
    externalId: string,
    attachedSources: ManualRunAttachedSource[] = [],
    /**
     * Optional per-call provider override — used by the compare-models
     * button to fire one run pinned to Anthropic and one pinned to
     * OpenAI in parallel. When omitted, the backend resolves from the
     * form's `ai_model_provider` column (defaults 'anthropic').
     */
    providerOverride?: 'anthropic' | 'openai',
    /**
     * Optional model-tier override — drives the Sonnet-vs-Opus compare
     * button. 'default' (or omitted) uses ANTHROPIC_DEFAULT_MODEL;
     * 'alt' uses ANTHROPIC_ALT_MODEL on the reasoning + verification
     * passes. Anthropic-only on the backend; passing 'alt' alongside
     * `providerOverride='openai'` will 400.
     */
    modelTier?: 'default' | 'alt',
  ) =>
    api
      .post<ManualRunResult>(
        '/ai-reviewer/run',
        {
          form_id: formId,
          kind,
          external_id: externalId,
          // Only emit the field when the caller actually attached
          // sources — keeps the legacy single-source request body
          // byte-identical so the route's backwards-compat path is
          // exercised exactly the same way it was before C6.
          ...(attachedSources.length > 0 ? { attached_sources: attachedSources } : {}),
          ...(providerOverride ? { provider: providerOverride } : {}),
          ...(modelTier ? { model_tier: modelTier } : {}),
        },
        { timeout: 720_000 },
      )
      .then((r) => r.data),

  // ── Rule packs ───────────────────────────────────────────────────────
  listRulePacks: () =>
    api.get<{ items: RulePackSummary[] }>('/ai-reviewer/rule-packs').then((r) => r.data.items),

  getFormRulePackKeys: (formId: number) =>
    api
      .get<{ form_id: number; keys: string[] }>(`/ai-reviewer/forms/${formId}/rule-packs`)
      .then((r) => r.data.keys),

  setFormRulePackKeys: (formId: number, keys: string[]) =>
    api
      .put<{ form_id: number; keys: string[] }>(`/ai-reviewer/forms/${formId}/rule-packs`, { keys })
      .then((r) => r.data.keys),

  // ── Diagnostics ──────────────────────────────────────────────────────
  /**
   * "Show me what the AI sees." Returns the composed system prompt for
   * the form's next AI run, broken down by section. Use this to catch
   * prompt bloat before it shows up as cost/latency drift.
   */
  getPromptPreview: (formId: number) =>
    api
      .get<PromptPreview>(`/ai-reviewer/forms/${formId}/preview-prompt`)
      .then((r) => r.data),

  /**
   * Latest drift snapshot for a form plus baseline + alerts. Backs the
   * page header drift badge and the "Drift" panel on AIReviewerFormDetail.
   */
  getDriftStatus: (formId: number) =>
    api.get<DriftStatus>(`/ai-reviewer/forms/${formId}/drift`).then((r) => r.data),

  /** MTD cost vs configured monthly budget. Backs the budget gauge + chip. */
  getCostStatus: (formId: number) =>
    api.get<CostStatus>(`/ai-reviewer/forms/${formId}/cost-status`).then((r) => r.data),

  // ── Calibration absorb lifecycle ─────────────────────────────────────
  /**
   * Get absorbed corrections for a form (no longer being injected as
   * few-shot examples but still counting for stats). Backs the "Show
   * absorbed" toggle in LearnedCorrectionsPanel.
   */
  getAbsorbedCorrections: (formId: number) =>
    api
      .get<{ items: AbsorbedCorrection[] }>(`/ai-reviewer/forms/${formId}/absorbed-corrections`)
      .then((r) => r.data.items),

  /**
   * Mark a single calibration row absorbed. Reason is required (typically
   * the rule-pack name + version where the lesson was baked in).
   */
  absorbCalibrationRow: (dataPointId: number, reason: string) =>
    api
      .post<{ id: number; form_id: number; absorbed_at: string; absorbed_reason: string }>(
        `/ai-reviewer/calibration/${dataPointId}/absorb`,
        { reason },
      )
      .then((r) => r.data),

  /**
   * Form-level reset — soft-archive every active calibration row for a
   * form. Use only when the form's questions have changed materially.
   */
  resetCalibrationForForm: (formId: number, reason: string) =>
    api
      .post<{ archived_count: number }>(`/ai-reviewer/forms/${formId}/calibration/reset`, {
        reason,
        confirm: 'RESET',
      })
      .then((r) => r.data),

  // ── Golden set + eval runs ───────────────────────────────────────────
  getGoldenSet: (formId: number) =>
    api
      .get<{ items: GoldenSetItem[] }>(`/ai-reviewer/forms/${formId}/golden-set`)
      .then((r) => r.data.items),

  getGoldenStatus: (submissionId: number) =>
    api
      .get<GoldenStatus>(`/ai-reviewer/golden-set/status/${submissionId}`)
      .then((r) => r.data),

  markSubmissionGolden: (submissionId: number, notes?: string | null) =>
    api
      .post<GoldenSetRow>('/ai-reviewer/golden-set/manual', { submission_id: submissionId, notes: notes ?? null })
      .then((r) => r.data),

  archiveGolden: (id: number, reason?: string) =>
    api
      .post<GoldenSetRow>(`/ai-reviewer/golden-set/${id}/archive`, { reason: reason ?? null })
      .then((r) => r.data),

  restoreGolden: (id: number) =>
    api
      .post<GoldenSetRow>(`/ai-reviewer/golden-set/${id}/restore`, {})
      .then((r) => r.data),

  // Eval runs (5-minute timeout — replays each golden submission through analyze())
  runEvalManual: (formId: number) =>
    api
      .post<EvalRunResult>(`/ai-reviewer/forms/${formId}/eval/run`, {}, { timeout: 5 * 60 * 1000 })
      .then((r) => r.data),

  getLatestEvalRun: (formId: number) =>
    api
      .get<LatestEvalRun | null>(`/ai-reviewer/forms/${formId}/eval/latest`)
      .then((r) => r.data),

  // ── Confidence calibration map ───────────────────────────────────────
  getCalibrationMap: (formId: number) =>
    api
      .get<CalibrationMapDetail>(`/ai-reviewer/forms/${formId}/calibration-map`)
      .then((r) => r.data),

  previewCalibrationFit: (formId: number) =>
    api
      .get<{ bins: CalibrationBin[]; sample_count: number; bins_with_data: number }>(
        `/ai-reviewer/forms/${formId}/calibration-map/preview`,
      )
      .then((r) => r.data),

  fitCalibrationMap: (formId: number) =>
    api
      .post<{ id: number; version: number; sample_count: number; bins: CalibrationBin[]; bins_with_data: number }>(
        `/ai-reviewer/forms/${formId}/calibration-map/fit`,
        {},
      )
      .then((r) => r.data),

  activateCalibrationMap: (formId: number, mapId: number) =>
    api
      .post<{ activated: number }>(`/ai-reviewer/forms/${formId}/calibration-map/${mapId}/activate`, {})
      .then((r) => r.data),

  // ── KB Coverage dashboard (Tier-2 Item 4) ────────────────────────────
  getKbCoverage: (formId: number, windowDays = 30) =>
    api
      .get<KbCoverageReport>(`/ai-reviewer/forms/${formId}/kb-coverage`, {
        params: { window: windowDays },
      })
      .then((r) => r.data),

  // ── Per-question rubrics (DB-backed; replaced file-based form-rubrics) ──
  getFormRubrics: (formId: number) =>
    api
      .get<{ form_id: number; rubrics: QuestionRubric[] }>(`/ai-reviewer/forms/${formId}/rubrics`)
      .then((r) => r.data.rubrics),

  upsertFormRubric: (formId: number, questionId: number, rubricMd: string) =>
    api
      .put<{ form_id: number; rubrics: QuestionRubric[] }>(
        `/ai-reviewer/forms/${formId}/rubrics/${questionId}`,
        { rubric_md: rubricMd },
      )
      .then((r) => r.data.rubrics),

  deleteFormRubric: (formId: number, questionId: number) =>
    api
      .delete<{ form_id: number; question_id: number; deleted: true }>(
        `/ai-reviewer/forms/${formId}/rubrics/${questionId}`,
      )
      .then((r) => r.data),

  // ── Rule pack library (DB-backed; replaced file-based rule-packs) ────
  listAllRulePacks: (includeArchived = false) =>
    api
      .get<{ items: RulePack[] }>('/ai-reviewer/rule-packs/all', {
        params: includeArchived ? { include_archived: 1 } : {},
      })
      .then((r) => r.data.items),

  getRulePack: (id: number) =>
    api.get<RulePack>(`/ai-reviewer/rule-packs/${id}`).then((r) => r.data),

  createRulePack: (payload: RulePackUpsertPayload) =>
    api.post<RulePack>('/ai-reviewer/rule-packs', payload).then((r) => r.data),

  updateRulePack: (id: number, payload: Partial<RulePackUpsertPayload>) =>
    api.put<RulePack>(`/ai-reviewer/rule-packs/${id}`, payload).then((r) => r.data),

  archiveRulePack: (id: number) =>
    api.delete<RulePack>(`/ai-reviewer/rule-packs/${id}`).then((r) => r.data),

  restoreRulePack: (id: number) =>
    api.post<RulePack>(`/ai-reviewer/rule-packs/${id}/restore`).then((r) => r.data),

  // ── Base prompt library (DB-backed; layer 1 of the 4-layer prompt model) ────
  listBasePrompts: (params?: { kind?: BasePromptKind; includeArchived?: boolean }) =>
    api
      .get<{ items: BasePromptSummary[] }>('/ai-reviewer/base-prompts', {
        params: {
          ...(params?.kind ? { kind: params.kind } : {}),
          ...(params?.includeArchived ? { include_archived: 1 } : {}),
        },
      })
      .then((r) => r.data.items),

  getBasePrompt: (id: number) =>
    api.get<BasePromptDetail>(`/ai-reviewer/base-prompts/${id}`).then((r) => r.data),

  getBasePromptHistory: (id: number, limit = 20) =>
    api
      .get<{ items: BasePromptVersion[] }>(`/ai-reviewer/base-prompts/${id}/history`, { params: { limit } })
      .then((r) => r.data.items),

  createBasePrompt: (payload: BasePromptUpsertPayload) =>
    api.post<BasePromptDetail>('/ai-reviewer/base-prompts', payload).then((r) => r.data),

  updateBasePrompt: (id: number, payload: Partial<BasePromptUpsertPayload>) =>
    api.put<BasePromptDetail>(`/ai-reviewer/base-prompts/${id}`, payload).then((r) => r.data),

  archiveBasePrompt: (id: number) =>
    api.post<BasePromptDetail>(`/ai-reviewer/base-prompts/${id}/archive`).then((r) => r.data),

  rollbackBasePrompt: (id: number, versionId: number) =>
    api.post<BasePromptDetail>(`/ai-reviewer/base-prompts/${id}/rollback/${versionId}`).then((r) => r.data),

  setBasePromptDefault: (id: number) =>
    api.post<BasePromptDetail>(`/ai-reviewer/base-prompts/${id}/set-default`).then((r) => r.data),

  // setFormBasePrompt was retired in 20260515090000: the Base prompt is
  // universal; forms cannot override it.
}

/**
 * Storage-level prompt kinds. Only `'base'` and `'trace'` are issuable
 * for new rows. Legacy `'single_source'` / `'synthesis'` only appear on
 * archived rows and are filtered out by `is_archived`.
 */
export type BasePromptKind = 'base' | 'trace'

export interface BasePromptSummary {
  id: number
  key: string
  name: string
  prompt_kind: BasePromptKind
  is_default: boolean
  is_archived: boolean
  current_version: number | null
  updated_at: string
}

export interface BasePromptDetail extends BasePromptSummary {
  description: string | null
  body: string
}

export interface BasePromptVersion {
  id: number
  base_prompt_id: number
  version: number
  body_md: string
  change_note: string | null
  created_by: number | null
  created_at: string
}

export interface BasePromptUpsertPayload {
  key?: string
  name: string
  description?: string | null
  prompt_kind: BasePromptKind
  body_md: string
  change_note?: string | null
  set_as_default?: boolean
}

export interface KbCoveragePivot {
  /** Pivot label as reported by the pivot detector. */
  label: string
  /** Number of submissions in the window where this pivot fired. */
  cases: number
  /** Mean kb_hit_count across those submissions. */
  avg_kb_hits: number
  /** True when cases >= 3 AND avg_kb_hits < 1 — a content gap signal. */
  gap: boolean
}

export interface KbCoverageReport {
  form_id: number
  window_days: number
  total_cases: number
  pivots: KbCoveragePivot[]
}

/** Per-(form, question) grading rubric authored on the form detail page. */
export interface QuestionRubric {
  question_id: number
  rubric_md: string
  updated_by: number | null
  updated_at: string
}

/**
 * Reusable rule pack — one block of policy/process text rendered into
 * the AI Reviewer system prompt for any form it's assigned to. Authored
 * on the Rule Pack Library page; assigned per form via the chip picker.
 */
export interface RulePack {
  id: number
  /** Stable slug; the public identifier referenced by chip picker assignments. */
  key: string
  name: string
  owner_dept: string
  /** Full markdown rule body. */
  body: string
  /** KB pages always loaded for runs that include this pack. */
  always_include_urls: string[]
  is_archived: boolean
  updated_at: string
}

/** Payload shape for create + update on the Rule Pack Library page. */
export interface RulePackUpsertPayload {
  /** Required on create; ignored on update (key is immutable post-creation). */
  key?: string
  name: string
  owner_dept: string
  body_md: string
  always_include_urls: string[]
}

export interface GoldenSetRow {
  id: number
  form_id: number
  submission_id: number
  source: 'auto_seed' | 'manual'
  marked_by: number | null
  marked_at: string
  notes: string | null
  archived_at: string | null
}

export interface GoldenSetItem extends GoldenSetRow {
  total_score: number | null
  ai_overall_confidence: number | null
  submitted_at: string | null
  ticket_id: number | null
}

export interface GoldenStatus {
  is_golden: boolean
  is_archived: boolean
  source: 'auto_seed' | 'manual' | null
  marked_at: string | null
}

export interface EvalRunPerSubmission {
  submission_id: number
  ticket_id: number | null
  status: 'evaluated' | 'skipped'
  reason?: string
  kappa?: number
  questions?: Array<{
    question_id: number
    question_text: string
    golden_value: string
    ai_value: string
    match: boolean
    ai_confidence: number | null
  }>
  kb_citation_count?: number
  timeline_step_count?: number
  observation_count?: number
  ai_overall_confidence?: number | null
  ai_calibrated_confidence?: number | null
  /** Phase 7c eval traces. */
  kb_citations?: Array<{ id: number; name: string; url: string }>
  timeline?: Array<{ step: number; description: string }>
  observations?: Array<{ category?: string | null; text: string }>
}

export interface EvalRunResult {
  id: number
  form_id: number
  ran_at: string
  triggered_by: 'manual' | 'rule_pack_change' | 'system_prompt_change' | 'scheduled' | 'ci'
  golden_set_count: number
  evaluated_count: number
  overall_kappa: number | null
  pass: boolean
  prev_overall_kappa: number | null
  delta_vs_prev: number | null
  per_submission: EvalRunPerSubmission[]
}

export interface CalibrationBin {
  low: number
  high: number
  calibrated: number
  sample_count?: number
}

export interface CalibrationCoverage {
  form_id: number
  sample_count: number
  min_samples: number
  ready_to_fit: boolean
  active_map_version: number | null
  active_map_fitted_at: string | null
}

export interface CalibrationMapVersion {
  id: number
  version: number
  fitted_at: string
  sample_count: number
  is_active: boolean
  notes: string | null
  bins: CalibrationBin[]
}

export interface CalibrationMapDetail {
  coverage: CalibrationCoverage
  active: { version: number; bins: CalibrationBin[]; fallback: number } | null
  versions: CalibrationMapVersion[]
}

export interface LatestEvalRun {
  id: number
  ran_at: string
  triggered_by: 'manual' | 'rule_pack_change' | 'system_prompt_change' | 'scheduled' | 'ci'
  golden_set_count: number
  overall_kappa: number | null
  pass: boolean
  results_json: { per_submission: EvalRunPerSubmission[]; delta_threshold?: number; prev_overall_kappa?: number | null }
  pack_hashes_json: Record<string, string>
  prompt_hash: string
}

export default aiReviewerService
