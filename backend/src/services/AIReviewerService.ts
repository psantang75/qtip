/**
 * AIReviewerService
 *
 * Fills out and submits real qtip audit forms via the existing submission
 * pipeline, attributed to the synthetic "AI Reviewer" user. Tickets ship
 * first; AR-Ops tasks and call transcripts plug in later via the same
 * InteractionAdapter contract.
 *
 * Pipeline (ticket path):
 *   1. Load form + validate ai_enabled, interaction_type, AI feedback question
 *   2. Adapter loads the audited material from the source system (CRM today)
 *   3. BookStack search by classification text → top-N page plaintext
 *   4. Claude Opus 4.7 fills out the form (structured JSON). Provider +
 *      model are env-driven via ANTHROPIC_DEFAULT_MODEL / OPENAI_DEFAULT_MODEL
 *      (see backend/src/config/environment.ts) — the OpenAI fork uses gpt-5.
 *   5. Map LLM JSON → SubmissionAnswer[]; validate every answer
 *   6. Hand off to SubmissionService.submitAudit (same code path humans use)
 *
 * Where to tune behavior (no hardcoded business rules in this file):
 *   - Per-form rules            → Form Builder "AI Reviewer Guidance"
 *                                 textarea (forms.ai_review_guidance), injected
 *                                 into the system prompt as
 *                                 ADDITIONAL FORM-SPECIFIC GRADING RULES.
 *   - Global grading philosophy → backend/src/services/aiReviewerPrompt.ts
 *                                 (the `system` string in buildAiReviewerPrompt).
 *   - KB retrieval depth/scope  → searchKb() below + BookStackService.
 *   - Playbook-driven KB        → tblPlayBookLink.LinkURL on each ticket's
 *                                 classification. searchKb() pulls those
 *                                 pages first (highest authority), then tops
 *                                 up with classification-text search hits,
 *                                 deduped by page id.
 *
 * Errors surface as AIReviewerServiceError with a stable code + statusCode.
 */

import prisma from '../config/prisma';
import { aiConfig } from '../config/ai';
import { aiReviewerConfig } from '../config/environment';
import { getAnthropicClient, isAnthropicConfigured } from './ai/AnthropicClient';
import { getOpenAIClient, isOpenAIConfigured } from './ai/OpenAIClient';
import {
  callChatModel,
  resolveCheapModelName,
  resolveModelName,
  type ModelProvider,
} from './ai/ChatModelClient';
import { buildAnswersTool, getGradeableQuestionIds } from './ai/AnswersToolSchema';
import bookstackService from './BookStackService';
import { type ParsedProcedure } from './kbProcedureParser';
import { SubmissionService } from './SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { AI_REVIEWER_FEEDBACK_QUESTION_TEXT } from '../repositories/MySQLFormRepository';
import logger from '../config/logger';
import type {
  CreateSubmissionAnswerDTO,
  SubmissionMetadataDTO,
  AiTimelineItem,
  AiObservation,
  AiPlaybookStep,
  AiCoaching,
  AiVerification,
} from '../models/Submission';
import { buildAiReviewerPrompt, loadFormRubrics, type FormForPrompt } from './aiReviewerPrompt';
import {
  buildTracePrompt,
  buildSynthesisPrompt,
  buildReasoningPrompt,
  buildAnswerChunkPrompt,
  groupGradeableQuestionsByCategory,
  type DraftAnswer,
} from './aiReviewerTwoPassPrompts';
import { withCallLog, type CallLogMeta } from './aiCallLogger';
import aiCalibrationService, { type CalibrationCorrection } from './AICalibrationService';
import rulePackService from './RulePackService';
import { estimateUsdCost, formatUsdCost, type CostEstimate } from './aiCostEstimator';
import { checkBudget } from './AIReviewerCostGuard';
import { applyCalibration, applyAnswerCalibration } from './ConfidenceCalibrator';
import { detectCasePivots, type CasePivot } from './aiReviewerPivotDetector';
import { voteOnTraces, type TraceAgreement } from './aiReviewerTraceVoting';
import {
  mergeUniqueStrings,
  tryParseJson,
  clampConfidence,
  clampDelta,
  escapeHtml,
} from './aiReviewerParsing';
import {
  parsePlaybookSteps,
  parseCoachingBlock,
  detectSelfConsistencyWarnings,
  enforceEvidenceFloor,
  parseTimelineArray,
  parseObservationsArray,
} from './aiReviewerOutputParsers';
import { composeCategoryFeedback, composeBottomFeedback } from './aiReviewerFeedback';
import { applyNaGateGuards, validateAnswerForQuestion } from './aiReviewerAnswerValidation';
import {
  searchKb,
  classifyCallTopic,
  fetchPivotKbPool,
  mergeKbHitsByUrl,
  UNIVERSAL_KB_URLS,
  type KbHit,
  type PivotKbCoverage,
} from './aiReviewerKb';
import {
  AIReviewerServiceError,
  formatCaseId,
  type InteractionMaterial,
  type SubmissionLinkPayload,
  type CaseSourceRef,
  type Case,
} from './aiReviewerTypes';
import {
  TicketAdapter,
  TaskAdapter,
  ConversationAdapter,
  pickAdapter,
  loadAdapterMaterial,
  formatRefId,
  resolvePostCallDocWindowMs,
  DEFAULT_POST_CALL_DOC_WINDOW_MIN,
  adapterLinkFor,
  mergeSubmissionLinks,
  filterPostAuditNotes,
  renderAuditScopeLine,
  type InteractionAdapter,
} from './aiReviewerCaseLoading';

// Re-exported so existing importers (e.g. aiReviewerPivotDetector) keep their
// `import { tryParseJson } from './AIReviewerService'` path.
export { tryParseJson } from './aiReviewerParsing';
// Re-exported so the reviewCase test's `import { _clearCallTopicCache } from
// '../AIReviewerService'` keeps working, and so any external importer of the
// `PivotKbCoverage` type is unaffected by the KB module extraction.
export { _clearCallTopicCache } from './aiReviewerKb';
export type { PivotKbCoverage } from './aiReviewerKb';
// Re-exported so external importers (routes, golden-eval runner, tests) keep
// their `import { AIReviewerServiceError, loadCase, type Case, ... } from
// './AIReviewerService'` paths after the types + case-loading extraction.
export { AIReviewerServiceError, formatCaseId } from './aiReviewerTypes';
export type {
  InteractionMaterial,
  SubmissionLinkPayload,
  CaseSourceRef,
  Case,
} from './aiReviewerTypes';
export { loadCase } from './aiReviewerCaseLoading';

export interface AIReviewResult {
  submission_id: number;
  /** 0 when status === 'DRAFT' (no scoring runs on drafts). */
  total_score: number;
  /** 'SUBMITTED' for the default flow; 'DRAFT' when the form has ai_submit_as_draft=true (Phase 5). */
  status: 'SUBMITTED' | 'DRAFT';
  message: string;
  ai_model: string;
  kb_pages_cited: { id: number; name: string; url: string }[];
  /**
   * TEMP COST ESTIMATOR — non-persistent per-run USD cost. NOT a database
   * column. Surfaced so the manual-run toast can display the cost. Will
   * be removed when we wire up real usage analytics.
   */
  cost_estimate?: { usd: number; formatted: string; approximated: boolean } | null;
}

export type AiProvider = 'anthropic' | 'openai';

/**
 * Result of running the analysis pipeline WITHOUT writing a submission.
 * Used by tooling (e.g. the dual-provider comparison script) that wants
 * to see what the model would have answered without polluting the audit
 * history.
 */
export interface AIAnalysisResult {
  provider: AiProvider;
  model: string;
  elapsedMs: number;
  retried: boolean;
  /** Header rendered exactly as it would appear in the prompt. */
  header: Record<string, string>;
  /** Notes count fed to the model. */
  notesCount: number;
  /** KB pages we placed into the prompt (with playbook flag). */
  kbPagesProvided: {
    id: number;
    name: string;
    url: string;
    is_playbook: boolean;
    /** Set when this page was added by KB link expansion (BFS from a primary hit). */
    linked_from?: { name: string; url: string; hop: number } | null;
  }[];
  /** Per-question answers, enriched with question text/type for reporting. */
  answers: {
    question_id: number;
    category_name: string;
    question_text: string;
    question_type: string;
    value: string;
    confidence: number | null;
  }[];
  /** Top-level narrative that would have populated the AI Reviewer Feedback. */
  narrative: string;
  /** KB citations the model produced. */
  kbCitations: { id: number; name: string; url: string }[];
  /** Top-level confidence the AI emitted for the whole review (null if not provided). */
  overallConfidence: number | null;
  /** AI-reconstructed chronological action timeline. */
  timeline: AiTimelineItem[];
  /** Non-scored advisory observations. */
  observations: AiObservation[];
}

/**
 * Public service surface. Methods for tasks and calls follow the same
 * shape as `reviewClosedTicket` once their adapters land.
 */
export class AIReviewerService {
  private readonly submissionService: SubmissionService;

  constructor() {
    this.submissionService = new SubmissionService(new MySQLSubmissionRepository());
  }

  isConfigured(): boolean {
    return aiReviewerConfig !== null && isAnthropicConfigured() && bookstackService.isConfigured();
  }

  async reviewClosedTicket(ticketId: number, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(TicketAdapter, ticketId, opts);
  }

  /**
   * AR-Ops / billing closed task. Mirrors the ticket flow but uses
   * `CRMService.getTaskHeader` + `getTaskNotes` for material loading.
   * Persists with `kind = 'TASK'` in `submission_ticket_tasks`.
   */
  async reviewClosedTask(taskId: number, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(TaskAdapter, taskId, opts);
  }

  /**
   * Phone-system call transcript (Genesys conversation ID). Materializes
   * a `Call` row in qtip on first use and links via `submission_calls`,
   * matching the existing virtual-call upsert path used by humans.
   */
  async reviewClosedConversation(conversationId: string, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(ConversationAdapter, conversationId, opts);
  }

  /**
   * Phase C (C2/C3) end-to-end multi-source review.
   *
   * Walks the existing two-pass prompt pipeline:
   *   1. Per source on the case (primary first, then attached) load the
   *      adapter material, classify the call topic when needed, ground
   *      against KB, and run a Pass-1 trace with `buildTracePrompt`
   *      (cheap model — Sonnet by default).
   *   2. Run a single Pass-2 synthesis with `buildSynthesisPrompt`
   *      (expensive model — Opus by default) over all per-source
   *      traces. The synthesis prompt is shaped exactly like the
   *      single-source prompt's output, so `mapClaudeOutputToAnswers`
   *      handles the result with no shape changes.
   *   3. Persist a SINGLE submission whose `case_id` is the case id
   *      and which carries `submission_ticket_tasks` rows for every
   *      TICKET/TASK source plus `submission_calls` rows for every
   *      CALL source. Inbox + readiness routing already groups by
   *      `case_id` (Phase C C4), so a multi-source submission appears
   *      as one row in the AI Inbox.
   *
   * The route layer is responsible for validating + capping the
   * `attached_sources` count (against `forms.ai_max_attached_sources`)
   * and constructing the Case via `loadCase`. Single-source callers
   * keep using `reviewClosedTicket / Task / Conversation`, which stay
   * on the leaner one-call `review()` path. We only pay for the
   * trace+synthesis split when a Case actually has attached sources.
   */
  async reviewCase(
    c: Case,
    opts: {
      formId: number;
      /**
       * Optional explicit provider override for THIS run. When omitted,
       * we resolve from the form's `ai_model_provider` column (defaults
       * to 'anthropic'). Set by the compare-models endpoint to force a
       * specific provider per side without touching the form column.
       * The trace pass always runs on Anthropic — only the synthesis
       * pipeline (reasoning + answer chunks + verification) switches.
       */
      provider?: ModelProvider;
      /**
       * Optional explicit reasoning-pass model name. When set, OVERRIDES
       * the provider's default model on the reasoning + verification
       * passes only (answer chunks + trace stay on the cheap model).
       * Used by the "Compare Sonnet vs Opus" button on the Manual Run
       * card: both lanes are Anthropic, one lane passes
       * `claude-opus-4-7`, the other `claude-sonnet-4-5`, so per-run
       * accuracy + cost can be diffed without touching the form column.
       */
      reasoningModelOverride?: string;
    }
  ): Promise<AIReviewResult> {
    if (!aiReviewerConfig) {
      throw new AIReviewerServiceError('AI Reviewer is not configured (set AI_REVIEWER_USER_ID).', 'NOT_CONFIGURED', 503);
    }
    // Resolve synthesis provider FIRST: explicit opts override > form
    // column > default 'anthropic'. The chosen provider drives all three
    // passes end-to-end (trace, reasoning, chunks) — workstream G made
    // the trace pass provider-agnostic so a Claude vs ChatGPT compare
    // is truly apples-to-apples instead of "same Anthropic trace,
    // different reasoner".
    const formRowForProvider = await prisma.form.findUnique({
      where: { id: opts.formId },
      select: { ai_model_provider: true },
    });
    const synthesisProvider: ModelProvider =
      opts.provider ??
      (formRowForProvider?.ai_model_provider === 'openai' ? 'openai' : 'anthropic');
    // Provider-specific config checks: only require the API key for the
    // provider we actually intend to call. An OpenAI-only deployment
    // shouldn't need ANTHROPIC_API_KEY just to boot the reviewer.
    if (synthesisProvider === 'anthropic' && !isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (synthesisProvider === 'openai' && !isOpenAIConfigured()) {
      throw new AIReviewerServiceError(
        'Form is configured for OpenAI synthesis but OPENAI_API_KEY is not set.',
        'NOT_CONFIGURED',
        503
      );
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const aiUserId = aiReviewerConfig.userId;
    const form = await loadFormForReview(opts.formId);
    const sources: CaseSourceRef[] = [c.primary, ...c.attached];

    // Cost guard: count every source on the case so multi-source runs
    // are priced at trace x N + synthesis x 1 (closes the C5/C6 TODO
    // documented in `review()`). The classifier mini-call adds when
    // ANY source on the case is a CALL.
    const budget = await checkBudget(opts.formId, {
      sourceCount: sources.length,
      willClassify: sources.some((s) => s.kind === 'CALL'),
      expectVerification: false,
    });
    if (!budget.allowed) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} BUDGET_EXCEEDED (case=${c.id}) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
      throw new AIReviewerServiceError(budget.reason, 'BUDGET_EXCEEDED', 503);
    }
    if (budget.warn) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} budget warn (>=80%) (case=${c.id}) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
    }

    // Per-source loop: load material + KB hits, run the trace pass, and
    // collect the Pass-2 inputs. The primary source also seeds the
    // submission's metadata (CSR, interaction date, link payload) so
    // multi-source submissions are filed under the primary's CSR — the
    // attached sources are evidence, not a second submission.
    const tracePayloads: Array<{
      kind: 'TICKET' | 'TASK' | 'CALL';
      id: string;
      traceJson: string;
      kbHits: KbHit[];
      link: SubmissionLinkPayload;
      // Forwarded into the synthesis prompt so Pass-2 / chunked Pass-2B can
      // grade ticket-header questions (Contact, Device Type, Assigned To, ...)
      // against the raw CRM values instead of relying on `traceJson` to have
      // preserved them. Same object the Pass-1 trace prompt already rendered.
      header: Record<string, string>;
    }> = [];

    // Tier-1 N-sample trace voting (Item 1): each per-source trace is
    // run K times in parallel on cheap Sonnet, majority-voted, and the
    // cross-run agreement composite is threaded into the synthesis
    // prompt as a hard ceiling on `overall_confidence`. Empty unless
    // K > 1; the synthesis builder skips the TRACE AGREEMENT block in
    // that case so the prompt stays back-compat with single-sample
    // runs (set AI_REVIEWER_TRACE_SAMPLES=1 to disable).
    const traceAgreements: TraceAgreement[] = [];

    // Per-run cost accumulator. Every pass that goes through
    // `withCallLog` (classifier + N x trace + synthesis + optional
    // verification) feeds its USD estimate into here via the
    // `onCost` sink on its CallLogMeta. The final `cost_estimate`
    // returned to the UI is the sum across passes, broken down per
    // pass in the post-run log line. Without this, the toast only
    // showed the synthesis call's cost and undercounted multi-source
    // runs by 30-50% (the trace x N + classifier + verification
    // calls were silently missing from the number — which is why a
    // CALL+TICKET case looked cheaper than an old single-pass ticket
    // review even though the actual spend was comparable).
    const costAccumulator: Array<{ pass: string; cost: CostEstimate }> = [];
    const accumulateCost = (passLabel: string) => (cost: CostEstimate | null) => {
      if (cost) costAccumulator.push({ pass: passLabel, cost });
    };
    let primaryMaterial: InteractionMaterial | null = null;
    // Keep every loaded material so submission-metadata resolution can
    // fall back to an attached source when the primary doesn't supply a
    // field (e.g. a CALL-primary case where the Genesys adapter has no
    // agentDisplayName but the attached TICKET does). Without this, the
    // CSR dropdown stays empty on the draft.
    const allMaterials: InteractionMaterial[] = [];

    // Phase A — load + validate every source up front. The per-source
    // adapter / ref / material triple is captured into `loaded[]` and
    // reused by Phase C below so we don't reload anything. Splitting
    // load from trace lets Phase B (the pivot detector) see EVERY
    // source's content before any KB lookups happen, which is what
    // makes compound-topic detection (e.g. "Install Refund" vs bare
    // "Refund") possible.
    const loaded: Array<{
      ref: CaseSourceRef;
      adapter: ReturnType<typeof pickAdapter>;
      material: InteractionMaterial;
    }> = [];
    // Call-window scoping: when primary is a CALL, derive an audit
    // cutoff (call_end + grace) AFTER the primary loads so we know the
    // call's end_et. Attached TICKET/TASK loaders then filter out notes
    // created after this cutoff — those notes are post-call commentary
    // by other agents (re-opens, supervisor edits, follow-up notes) and
    // must not flow into the synthesis prompt or the AI will produce
    // hindsight grades.
    let auditCutoffAt: Date | null = null;
    for (let i = 0; i < sources.length; i++) {
      const ref = sources[i];
      const isPrimary = i === 0;
      const adapter = pickAdapter(ref);
      const material = await loadAdapterMaterial(adapter, ref, auditCutoffAt);
      if (!adapter.isClosed(material)) {
        throw new AIReviewerServiceError(
          `${adapter.kind} ${formatRefId(ref)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
          'INTERACTION_NOT_CLOSED',
          422
        );
      }
      allMaterials.push(material);
      if (isPrimary) {
        primaryMaterial = material;
        if (adapter.kind === 'CALL') {
          // Anchor on closedOn (call end_et). Fall back to interactionDate
          // (call start_et) if end_et is missing — better to over-include
          // by the grace window than to filter nothing.
          const anchor = material.closedOn ?? material.interactionDate;
          if (anchor) {
            auditCutoffAt = new Date(anchor.getTime() + resolvePostCallDocWindowMs());
            logger.info(
              `[AI REVIEWER CASE] call-window scoping enabled for case=${c.id}: ` +
                `anchor=${anchor.toISOString()} (${material.closedOn ? 'closedOn' : 'interactionDate'}), ` +
                `cutoff=${auditCutoffAt.toISOString()} (+${process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN ?? DEFAULT_POST_CALL_DOC_WINDOW_MIN}min)`
            );
          }
        }
      }
      loaded.push({ ref, adapter, material });
    }

    if (!primaryMaterial) {
      throw new AIReviewerServiceError('Primary source material failed to load', 'INTERNAL', 500);
    }

    // Phase B — combined pivot detection + per-pivot KB pool. ONE
    // cheap Sonnet call looks at every source and returns the
    // distinct topical pivots the agent had to handle (primary topic
    // PLUS compound qualifiers). Each pivot drives an independent
    // `searchKb` lookup; the union (deduped by URL, capped) is the
    // shared KB pool that every per-source trace will see in Phase C.
    //
    // Fail-open: when the detector returns no pivots (Anthropic down,
    // bad JSON, empty case), `pivots` is `[]` and Phase C falls back
    // to the legacy per-source `classifyCallTopic`-driven KB lookup
    // — same behaviour the multi-source path had before this change.
    const pivots = await detectCasePivots(
      loaded.map((l) => ({
        kind: l.adapter.kind,
        id: formatRefId(l.ref),
        header: l.material.header,
        notesOrTranscript: l.material.notesOrTranscript.map((n) => ({ note: n.note ?? '' })),
      })),
      { caseId: c.id, formId: opts.formId, onCost: accumulateCost('pivot_detection') }
    );

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    // Pivot KB pool + per-pivot coverage. Coverage is persisted into
    // ai_extras.pivots so the KB Coverage dashboard (Tier-2 Item 4)
    // can flag pivots that consistently return zero KB hits as
    // content gaps without re-running the whole pivot detector.
    const { pool: pivotKbPool, coverage: pivotCoverage } =
      pivots.length > 0
        ? await fetchPivotKbPool(pivots, packAnchorUrls)
        : { pool: [] as KbHit[], coverage: [] as PivotKbCoverage[] };

    // Phase C — per-source trace loop. Each source still gets its own
    // trace prompt (sourceKind / id / header / notes), but its KB
    // context now comes from one of two places:
    //   - When the pivot detector found pivots, every trace shares the
    //     pivot KB pool (already merged with the form's rule-pack
    //     anchors and universal URLs). Per-source classifier is SKIPPED.
    //   - When pivots is empty (detector returned nothing), we fall
    //     back to the legacy per-source classifier + searchKb path so
    //     the multi-source review never regresses below pre-pivot
    //     behaviour.
    for (const { ref, adapter, material } of loaded) {
      let kbHits: KbHit[];
      if (pivots.length > 0) {
        const sourceMandatory = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
        // Re-run searchKb with an empty query so we still pick up the
        // mandatory + universal URLs for this specific source (e.g. a
        // ticket's playbook links), then merge with the pivot pool.
        const sourceMandatoryHits = await searchKb('', sourceMandatory, UNIVERSAL_KB_URLS, adapter.kind);
        kbHits = mergeKbHitsByUrl(pivotKbPool, sourceMandatoryHits);
      } else {
        // Legacy path: per-source classifier seeds the KB query.
        if (adapter.kind === 'CALL' && !material.classificationText) {
          const classified = await classifyCallTopic(
            formatRefId(ref),
            material.notesOrTranscript[0]?.note ?? '',
            { onCost: accumulateCost('classification') }
          );
          if (classified) {
            material.classificationText = classified;
          }
        }
        const sourceMandatory = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
        kbHits = await searchKb(
          material.classificationText,
          sourceMandatory,
          UNIVERSAL_KB_URLS,
          adapter.kind
        );
      }

      const tracePrompt = buildTracePrompt({
        form,
        sourceKind: adapter.kind,
        sourceId: formatRefId(ref),
        header: material.header,
        notes: material.notesOrTranscript,
        kbHits,
      });

      const traceCtx: CallLogMeta = {
        provider: synthesisProvider,
        purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.trace`,
        pass: 'trace',
        ticketId: adapter.kind === 'TICKET' && typeof ref.external_id === 'number' ? ref.external_id : null,
        formId: opts.formId,
        caseId: c.id,
        onCost: accumulateCost(`trace:${adapter.kind.toLowerCase()}`),
      };

      // Tier-1 self-consistency K: fire K independent trace samples in
      // parallel, then majority-vote the structured fields. Each
      // sample uses the SAME prompt + KB context — variation comes
      // entirely from the model's stochasticity, which is exactly the
      // signal we want to measure ("what does the model agree with
      // itself about?"). K=1 short-circuits the parallel fan-out so
      // the legacy single-sample behaviour is reachable via env var
      // (AI_REVIEWER_TRACE_SAMPLES=1) for cost-sensitive runs.
      // Promise.all keeps wall time at one trace; cost is K * trace.
      const K_TRACE_SAMPLES = Math.max(1, Number(process.env.AI_REVIEWER_TRACE_SAMPLES ?? 3));
      let traceJson: string;
      if (K_TRACE_SAMPLES === 1) {
        traceJson = await runTracePass(tracePrompt, traceCtx, synthesisProvider);
      } else {
        const samples = await Promise.all(
          Array.from({ length: K_TRACE_SAMPLES }, () =>
            runTracePass(tracePrompt, traceCtx, synthesisProvider)
          )
        );
        const { mergedTraceJson, agreement } = voteOnTraces(samples);
        traceJson = mergedTraceJson;
        traceAgreements.push({
          ...agreement,
          sourceKind: adapter.kind,
          sourceId: formatRefId(ref),
        });
        logger.info(
          `[AI REVIEWER] trace voting (case=${c.id}, source=${adapter.kind}:${formatRefId(ref)}) ` +
            `k=${agreement.k} composite=${agreement.composite.toFixed(2)} ` +
            `playbook=${agreement.playbookAgreement.toFixed(2)} claims=${agreement.claimAgreement.toFixed(2)} ` +
            `observations=${agreement.observationAgreement.toFixed(2)} ` +
            `dropped=playbook:${agreement.droppedItems.playbook},obs:${agreement.droppedItems.observations},claims:${agreement.droppedItems.claims}`
        );
      }

      // Adapter-supplied link payload — the persistence layer merges
      // these so a ticket+call case writes both submission_ticket_tasks
      // and submission_calls rows on the same submission.
      const link = adapterLinkFor(ref, material);
      tracePayloads.push({
        kind: adapter.kind,
        id: formatRefId(ref),
        traceJson,
        kbHits,
        link,
        header: material.header,
      });
    }

    // Pass-2 synthesis: same answer/narrative shape as the single-pass
    // path, so callClaude + mapClaudeOutputToAnswers handles it as-is.
    const corrections = await loadCorrectionsForPrompt(opts.formId, primaryMaterial.classificationText);

    // Workstream B2: flat, deduped list of KB pages actually loaded
    // into Pass-1 (across all sources, all pivots). Surfaced to Pass-2
    // as a `KB PAGES LOADED FOR THIS CASE` block so the KB-NA rule in
    // the synthesis addendum can fire deterministically when this list
    // is empty. Without it, synthesis had no idea whether the absence
    // of `kb_citations` in the traces was "KB exists but trace forgot
    // it" vs "KB never existed for this topic" — and would silently
    // fall back to ticket notes as the de-facto playbook.
    const kbAnchorsSeen = new Set<string>();
    const kbAnchors: Array<{ url: string; name: string; is_playbook: boolean }> = [];
    // Phase F (F3): also collect the parsed KB PROCEDURE structures so
    // the reasoning + synthesis passes see the same authoritative
    // procedure data the per-source trace pass saw. Deduped by page
    // URL across all sources (same dedup key as kbAnchors).
    const kbProcedures: Array<{ pageName: string; pageUrl: string; procedure: ParsedProcedure }> = [];
    for (const t of tracePayloads) {
      for (const h of t.kbHits) {
        if (!h.url || kbAnchorsSeen.has(h.url)) continue;
        kbAnchorsSeen.add(h.url);
        kbAnchors.push({
          url: h.url,
          name: h.name,
          is_playbook: Boolean(h.is_playbook),
        });
        if (h.procedure && Array.isArray(h.procedure.approaches) && h.procedure.approaches.length > 0) {
          kbProcedures.push({ pageName: h.name, pageUrl: h.url, procedure: h.procedure });
        }
      }
    }

    const synthesisInput = {
      form,
      traces: tracePayloads.map((t) => ({
        sourceKind: t.kind,
        sourceId: t.id,
        traceJson: t.traceJson,
        header: t.header,
      })),
      corrections,
      pivots,
      traceAgreements,
      kbAnchors,
      kbProcedures,
    };

    const ticketIdForLog =
      c.primary.kind === 'TICKET' && typeof c.primary.external_id === 'number' ? c.primary.external_id : null;

    // Built once and shared by both synthesis branches and the
    // downstream verification pass. The verifier overrides `purpose`
    // and `pass` on the spread; everything else (case_id, form_id,
    // ticket_id, accumulator) is consistent across both paths so the
    // verification call-log row joins correctly to the same case.
    const synthesisCtx: CallLogMeta = {
      provider: synthesisProvider,
      purpose: 'ai_reviewer.case.synthesis',
      pass: 'synthesis',
      ticketId: ticketIdForLog,
      formId: opts.formId,
      caseId: c.id,
      onCost: accumulateCost('synthesis'),
    };

    // Chunked synthesis path: large forms (>= AI_REVIEWER_CHUNKED_SYNTHESIS_THRESHOLD
    // gradeable questions) split synthesis into Pass 2A (Opus reasoning,
    // no answers) + parallel Pass 2B (Sonnet, one chunk per category)
    // to dodge the wall-clock cliff that hits monolithic Opus on
    // 50+ question forms (output saturates 16k tokens, takes 5-8 min,
    // and frequently truncates).
    const gradeableCount = form.questions.filter((q) => {
      const t = (q.question_type ?? '').toUpperCase();
      return t !== 'TEXT' && t !== 'INFO_BLOCK' && t !== 'SUB_CATEGORY';
    }).length;
    const chunkedThreshold = Math.max(
      1,
      Number(process.env.AI_REVIEWER_CHUNKED_SYNTHESIS_THRESHOLD) || 30
    );
    const useChunkedSynthesis = gradeableCount >= chunkedThreshold;

    // overallConfidence is `let` rather than `const` because the
    // verification pass (Tier-1 Item 2) applies an asymmetric delta to
    // it before persistence — the calibrated number we store has to
    // reflect the verifier's audit, not the raw synthesis self-report.
    const synthesisOutput: ClaudeOutput = useChunkedSynthesis
      ? await runChunkedSynthesis(synthesisInput, form, {
          formId: opts.formId,
          caseId: c.id,
          ticketId: ticketIdForLog,
          accumulateCost,
          provider: synthesisProvider,
          reasoningModelOverride: opts.reasoningModelOverride,
        })
      : await callClaude(buildSynthesisPrompt(synthesisInput), form, synthesisCtx);

    if (useChunkedSynthesis) {
      logger.info(
        `[AI REVIEWER] chunked synthesis used (case=${c.id}, form=${opts.formId}, ` +
          `gradeable_questions=${gradeableCount}, threshold=${chunkedThreshold})`
      );
    }

    const {
      answers,
      narrative: _narrative,
      categoryNotes,
      kbCitations,
      overallConfidence: rawOverallConfidence,
      timeline,
      observations,
      playbookSteps,
      coaching,
      answerEvidence,
      selfConsistencyWarnings,
      // synthesis cost is captured via the per-pass `onCost` sinks
      // (reasoning + per-chunk for the chunked path, single 'synthesis'
      // sink for the monolithic path); the local `cost` here is
      // intentionally unused so the aggregated `aggregatedCostPayload`
      // below stays the single source of truth.
    } = synthesisOutput;
    // `narrative` (cross-cutting flat findings) is intentionally NOT
    // routed to any submission_answer per the 2026-05 reviewer ask
    // ("no other notes in the AI reviewer feedback at the bottom for
    // now"). It still lives in the call-log raw response for debugging.
    void _narrative;
    let overallConfidence = rawOverallConfidence;

    // Verification pass (Tier-1 Item 2). Trigger band widened from
    // "<0.6" to "0.40 <= overall < 0.85" so genuinely-confident AND
    // genuinely-collapsed cases skip verification, but the wide
    // ambiguous middle band where the model "feels confident but
    // shouldn't" routes through the verifier. Self-consistency
    // warnings (including the new evidence-floor warnings) still
    // force-trigger verification regardless of band. The verifier
    // returns deltas the orchestrator applies before persistence —
    // unlike the legacy implementation, the confidence number we
    // store actually reflects the verifier's audit.
    const VERIFICATION_LO = 0.4;
    const VERIFICATION_HI = 0.85;
    const inAmbiguousBand =
      overallConfidence != null && overallConfidence >= VERIFICATION_LO && overallConfidence < VERIFICATION_HI;
    const needsVerification = inAmbiguousBand || selfConsistencyWarnings.length > 0;
    let verification: AiVerification | null = null;
    if (needsVerification) {
      const triggers: string[] = [];
      if (inAmbiguousBand) triggers.push('ambiguous_confidence');
      if (selfConsistencyWarnings.length > 0) triggers.push('self_consistency');
      try {
        const result = await runVerificationPass(
          { answers, timeline, playbookSteps, observations, categoryNotes, coaching },
          { ...synthesisCtx, purpose: `${synthesisCtx.purpose}.verification`, pass: 'verification' },
          synthesisProvider,
          opts.reasoningModelOverride
        );
        overallConfidence = applyVerificationDeltas(answers, overallConfidence, result, `case=${c.id}`);
        verification = {
          trigger: triggers.join(','),
          warnings: result.warnings,
          threshold: VERIFICATION_HI,
          overall_delta: result.overall_delta,
          per_answer_deltas: result.per_answer_deltas,
        };
        logger.info(
          `[AI REVIEWER] verification pass (case=${c.id}) triggers=[${triggers.join(',')}] ` +
            `warnings=${result.warnings.length} overall_delta=${result.overall_delta.toFixed(2)} ` +
            `per_answer_deltas=${Object.keys(result.per_answer_deltas).length}`
        );
      } catch (verifyErr) {
        logger.warn(`[AI REVIEWER] verification pass failed (case=${c.id}): ${(verifyErr as Error).message}`);
        verification = {
          trigger: triggers.join(','),
          warnings: [],
          threshold: VERIFICATION_HI,
          overall_delta: 0,
          per_answer_deltas: {},
        };
      }
    }

    // Compose answers (with the auto-managed feedback question), build
    // metadata against the primary, merge per-source link payloads, and
    // persist as ONE submission keyed by case_id.
    const feedbackQuestion = form.questions.find((q) => q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT);
    if (!feedbackQuestion) {
      throw new AIReviewerServiceError(
        `Form ${form.id} is missing the auto-managed "AI Reviewer Feedback" question. Re-save the form in the form builder to repair it.`,
        'FORM_MISSING_AI_FEEDBACK_QUESTION',
        422
      );
    }
    // Route per-category notes into their category's Feedback TEXT
    // question when one exists; unmatched notes plus KB citations fall
    // through to the bottom AI Reviewer Feedback question.
    const { perCategory, unmatched } = composeCategoryFeedback(
      categoryNotes,
      form,
      kbCitations
    );
    const bottomFeedbackText = composeBottomFeedback({
      unmatchedCategoryNotes: unmatched,
      kbCitations,
    });
    const finalAnswers: CreateSubmissionAnswerDTO[] = [
      ...answers,
      ...Array.from(perCategory.entries()).map(([qid, html]) => ({
        question_id: qid,
        answer: html,
      })),
      { question_id: feedbackQuestion.id, answer: bottomFeedbackText },
    ];

    // Resolve agentDisplayName / interactionDate with attached-source
    // fallback: prefer the primary's value, otherwise use the first
    // attached source that supplies one. This is what makes a CALL+TICKET
    // multi-source case populate the CSR dropdown on the draft — the
    // CALL adapter never knows the agent name, but the attached TICKET
    // does (assigned_to_name).
    const resolvedAgentDisplayName =
      primaryMaterial.agentDisplayName ??
      allMaterials.find((m) => m !== primaryMaterial && m.agentDisplayName)?.agentDisplayName ??
      null;
    const resolvedInteractionDate =
      primaryMaterial.interactionDate ??
      allMaterials.find((m) => m !== primaryMaterial && m.interactionDate)?.interactionDate ??
      null;

    const { csrId, metadata } = await buildSubmissionMetadata({
      formId: form.id,
      agentDisplayName: resolvedAgentDisplayName,
      interactionDate: resolvedInteractionDate,
    });

    // CALL-primary cases default the CSR to the AI Reviewer user when
    // the form metadata didn't resolve one (mirrors single-source).
    const hasCallSource = sources.some((s) => s.kind === 'CALL');
    const callCsrId = hasCallSource ? csrId ?? aiUserId : csrId;

    // Per-answer calibration (Tier-1 Item 3). Runs AFTER the verifier
    // has applied its deltas so the calibration sees the final
    // post-verification numbers. Gated by AI_REVIEWER_PER_QUESTION_CALIBRATION
    // inside applyAnswerCalibration — when off this is identity for
    // every answer.
    for (const a of answers) {
      a.ai_confidence = await applyAnswerCalibration(form.id, a.question_id, a.ai_confidence ?? null);
    }
    const calibratedConfidence = await applyCalibration(form.id, overallConfidence ?? null);

    const mergedLink = mergeSubmissionLinks(tracePayloads.map((t) => t.link));

    const payload = {
      form_id: form.id,
      submitted_by: aiUserId,
      csr_id: callCsrId,
      case_id: c.id,
      ai_provider: synthesisProvider,
      metadata,
      answers: finalAnswers,
      ai_overall_confidence: overallConfidence,
      ai_calibrated_confidence: calibratedConfidence,
      ai_extras: buildAiExtras({
        timeline,
        observations,
        playbookSteps,
        coaching,
        answerEvidence,
        selfConsistencyWarnings,
        verification,
        pivots: pivotCoverage,
      }),
      ...mergedLink,
    };

    const sourceLabels = sources.map((s) => formatCaseId(s)).join(', ');
    logger.info(
      `[AI REVIEWER] case=${c.id} sources=[${sourceLabels}] ` +
        `overall_confidence=${overallConfidence == null ? 'null' : overallConfidence.toFixed(2)} ` +
        `calibrated_confidence=${calibratedConfidence == null ? 'null' : calibratedConfidence.toFixed(2)} ` +
        `timeline_items=${timeline?.length ?? 0} observations=${observations?.length ?? 0}`
    );

    // Aggregate per-pass costs into a single payload for the UI toast.
    // Sums across classifier + N x trace + synthesis + optional
    // verification, since each pass's `withCallLog` invocation pushed
    // its own CostEstimate via the `onCost` sink wired into its meta.
    // `approximated` is true if ANY pass fell back to FALLBACK_PRICING
    // (e.g. an unknown model id), so the UI can flag the number.
    const totalUsd = costAccumulator.reduce((sum, entry) => sum + entry.cost.usd, 0);
    const anyApproximated = costAccumulator.some((entry) => entry.cost.approximated);
    const aggregatedCostPayload =
      costAccumulator.length > 0
        ? { usd: totalUsd, formatted: formatUsdCost(totalUsd), approximated: anyApproximated }
        : null;
    if (aggregatedCostPayload) {
      const breakdown = costAccumulator
        .map((e) => `${e.pass}=${e.cost.formatted}`)
        .join(' ');
      logger.info(
        `[AI REVIEWER] TEMP COST ESTIMATOR (case=${c.id}) total=${aggregatedCostPayload.formatted} ` +
          `passes=${costAccumulator.length} | ${breakdown}`
      );
    }

    if (form.ai_submit_as_draft) {
      const draftResult = await this.submissionService.saveDraft(payload, aiUserId);
      logger.info(
        `[AI REVIEWER] Saved DRAFT submission_id=${draftResult.submission_id} for case=${c.id} (awaiting human review).`
      );
      return {
        submission_id: draftResult.submission_id,
        total_score: 0,
        status: 'DRAFT',
        message: draftResult.message,
        ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
        kb_pages_cited: kbCitations,
        cost_estimate: aggregatedCostPayload,
      };
    }

    const submitResult = await this.submissionService.submitAudit(payload, aiUserId);
    logger.info(
      `[AI REVIEWER] Submitted multi-source audit submission_id=${submitResult.submission_id} for case=${c.id} score=${submitResult.total_score}`
    );
    return {
      submission_id: submitResult.submission_id,
      total_score: submitResult.total_score,
      status: 'SUBMITTED',
      message: submitResult.message,
      ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
      kb_pages_cited: kbCitations,
      cost_estimate: aggregatedCostPayload,
    };
  }

  /**
   * Run the analysis pipeline (load form, load material, KB grounding,
   * LLM call, parse, validate) WITHOUT writing a submission. Intended for
   * provider-comparison tooling and offline experimentation. Supports
   * `provider: 'anthropic' | 'openai'` so the same prompt can be evaluated
   * across models.
   */
  async analyzeTicket(
    ticketId: number,
    opts: { formId: number; provider?: AiProvider }
  ): Promise<AIAnalysisResult> {
    return this.analyze(TicketAdapter, ticketId, {
      formId: opts.formId,
      provider: opts.provider ?? 'anthropic',
    });
  }

  /**
   * Phase B (B5): call-side counterpart to {@link analyzeTicket}. Used by
   * the golden-eval runner to replay a CALL-kind golden submission
   * through the same pipeline. `conversationId` is the Genesys
   * conversation id (the string stored in `calls.call_id`), NOT the
   * internal `calls.id` integer — that lookup is the eval runner's
   * responsibility because the golden table indexes Submission ids only.
   */
  async analyzeConversation(
    conversationId: string,
    opts: { formId: number; provider?: AiProvider }
  ): Promise<AIAnalysisResult> {
    return this.analyze(ConversationAdapter, conversationId, {
      formId: opts.formId,
      provider: opts.provider ?? 'anthropic',
    });
  }

  private async analyze<TId>(
    adapter: InteractionAdapter<TId>,
    sourceId: TId,
    opts: { formId: number; provider: AiProvider }
  ): Promise<AIAnalysisResult> {
    if (opts.provider === 'anthropic' && !isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (opts.provider === 'openai' && !isOpenAIConfigured()) {
      throw new AIReviewerServiceError('OpenAI is not configured (set OPENAI_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const form = await loadFormForReview(opts.formId);
    const material = await adapter.loadMaterial(sourceId);
    if (!adapter.isClosed(material)) {
      throw new AIReviewerServiceError(
        `${adapter.kind} ${adapter.formatId(sourceId)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
        'INTERACTION_NOT_CLOSED',
        422
      );
    }

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    const mandatoryUrls = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
    const kbHits = await searchKb(
      material.classificationText,
      mandatoryUrls,
      UNIVERSAL_KB_URLS,
      adapter.kind
    );
    const corrections = await loadCorrectionsForPrompt(opts.formId, material.classificationText);
    const promptParts = buildAiReviewerPrompt({
      form,
      adapterKind: adapter.kind,
      header: material.header,
      notes: material.notesOrTranscript,
      kbHits,
      corrections,
    });

    const started = Date.now();
    const traceCtx: CallLogMeta = {
      provider: opts.provider,
      purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.analyze`,
      pass: 'single_pass',
      ticketId: adapter.kind === 'TICKET' && typeof sourceId === 'number' ? sourceId : null,
      formId: opts.formId,
    };
    const { answers, narrative, kbCitations, overallConfidence, timeline, observations, model, retried } =
      await callLlm(opts.provider, promptParts, form, traceCtx);
    const elapsedMs = Date.now() - started;

    const questionsById = new Map(form.questions.map((q) => [q.id, q]));
    const enrichedAnswers = answers.map((a) => {
      const q = questionsById.get(a.question_id);
      return {
        question_id: a.question_id,
        category_name: q?.category_name ?? '(unknown)',
        question_text: q?.question_text ?? '(unknown)',
        question_type: q?.question_type ?? '(unknown)',
        value: a.answer,
        confidence: a.ai_confidence ?? null,
      };
    });

    return {
      provider: opts.provider,
      model,
      elapsedMs,
      retried,
      header: material.header,
      notesCount: material.notesOrTranscript.length,
      kbPagesProvided: kbHits.map((h) => ({
        id: h.id,
        name: h.name,
        url: h.url,
        is_playbook: h.is_playbook,
        linked_from: h.linked_from ?? null,
      })),
      answers: enrichedAnswers,
      narrative,
      kbCitations,
      overallConfidence,
      timeline,
      observations,
    };
  }

  /**
   * Generic review path shared by every InteractionAdapter. Public methods
   * (reviewClosedTicket / reviewClosedTask / reviewClosedConversation)
   * just pick the adapter and forward through here.
   */
  private async review<TId>(
    adapter: InteractionAdapter<TId>,
    sourceId: TId,
    opts: { formId: number }
  ): Promise<AIReviewResult> {
    if (!aiReviewerConfig) {
      throw new AIReviewerServiceError('AI Reviewer is not configured (set AI_REVIEWER_USER_ID).', 'NOT_CONFIGURED', 503);
    }
    if (!isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const aiUserId = aiReviewerConfig.userId;
    const form = await loadFormForReview(opts.formId);

    // Phase 7b: per-form monthly cost budget. Budget hit -> short-circuit
    // before we burn another LLM call. We surface this as a 503 with code
    // BUDGET_EXCEEDED so the route handler can route the submission to a
    // human reviewer with an explanation rather than silently failing or
    // producing a degraded AI grade.
    // Phase C (C5): tell the cost guard how this run will be priced so
    // it can deny multi-source cases that would push us over the cap
    // *before* we make the LLM calls. Single-source single-pass runs
    // pre-date C5 and the shape is `sourceCount=1`,
    // `expectVerification=false`, `willClassify` only when CALL needs
    // its topic classifier. Multi-source two-pass runs (C3) will pass
    // their actual `attachedSources.length + 1` here once the pipeline
    // is wired through; that's the C6 task.
    const budget = await checkBudget(opts.formId, {
      sourceCount: 1,
      willClassify: adapter.kind === 'CALL',
      expectVerification: false,
    });
    if (!budget.allowed) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} BUDGET_EXCEEDED mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
      throw new AIReviewerServiceError(budget.reason, 'BUDGET_EXCEEDED', 503);
    }
    if (budget.warn) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} budget warn (>=80%) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
    }

    const material = await adapter.loadMaterial(sourceId);
    if (!adapter.isClosed(material)) {
      throw new AIReviewerServiceError(
        `${adapter.kind} ${adapter.formatId(sourceId)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
        'INTERACTION_NOT_CLOSED',
        422
      );
    }

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    const mandatoryUrls = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);

    // Phase B: when a call has no classification (the source system
    // doesn't capture a wrap-up code today), run a tiny topic-classifier
    // call so searchKb actually has a query to work with. Without this,
    // CALL reviews skip both BookStack full-text search and semantic
    // search and grade with zero KB grounding.
    if (adapter.kind === 'CALL' && !material.classificationText) {
      const classified = await classifyCallTopic(
        adapter.formatId(sourceId),
        material.notesOrTranscript[0]?.note ?? ''
      );
      if (classified) {
        material.classificationText = classified;
      }
    }

    const kbHits = await searchKb(
      material.classificationText,
      mandatoryUrls,
      UNIVERSAL_KB_URLS,
      adapter.kind
    );
    const corrections = await loadCorrectionsForPrompt(opts.formId, material.classificationText);

    const promptParts = buildAiReviewerPrompt({
      form,
      adapterKind: adapter.kind,
      header: material.header,
      notes: material.notesOrTranscript,
      kbHits,
      corrections,
    });

    const traceCtx: CallLogMeta = {
      provider: 'anthropic',
      purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.review`,
      pass: 'single_pass',
      ticketId: adapter.kind === 'TICKET' && typeof sourceId === 'number' ? sourceId : null,
      formId: opts.formId,
    };
    const {
      answers,
      narrative: _narrativeSingle,
      categoryNotes,
      kbCitations,
      overallConfidence: rawOverallConfidence,
      timeline,
      observations,
      playbookSteps,
      coaching,
      answerEvidence,
      selfConsistencyWarnings,
      cost,
    } = await callClaude(promptParts, form, traceCtx);
    // Cross-cutting flat `narrative` is intentionally not persisted to
    // a submission_answer; see the multi-source write site for the
    // rationale (2026-05 reviewer ask).
    void _narrativeSingle;
    let overallConfidence = rawOverallConfidence;
    const costPayload = cost
      ? { usd: cost.usd, formatted: cost.formatted, approximated: cost.approximated }
      : null;

    // Verification pass (Tier-1 Item 2). Trigger band widened from
    // "<0.6" to "0.40 <= overall < 0.85" so the wide ambiguous middle
    // routes through the verifier. The verifier returns deltas the
    // orchestrator applies before persistence.
    const VERIFICATION_LO = 0.4;
    const VERIFICATION_HI = 0.85;
    const inAmbiguousBand =
      overallConfidence != null && overallConfidence >= VERIFICATION_LO && overallConfidence < VERIFICATION_HI;
    const needsVerification = inAmbiguousBand || selfConsistencyWarnings.length > 0;
    let verification: AiVerification | null = null;
    if (needsVerification) {
      const triggers: string[] = [];
      if (inAmbiguousBand) triggers.push('ambiguous_confidence');
      if (selfConsistencyWarnings.length > 0) triggers.push('self_consistency');
      try {
        const result = await runVerificationPass(
          { answers, timeline, playbookSteps, observations, categoryNotes, coaching },
          { ...traceCtx, purpose: `${traceCtx.purpose}.verification`, pass: 'verification' }
        );
        overallConfidence = applyVerificationDeltas(answers, overallConfidence, result, `single`);
        verification = {
          trigger: triggers.join(','),
          warnings: result.warnings,
          threshold: VERIFICATION_HI,
          overall_delta: result.overall_delta,
          per_answer_deltas: result.per_answer_deltas,
        };
        logger.info(
          `[AI REVIEWER] verification pass triggers=[${triggers.join(',')}] ` +
            `warnings=${result.warnings.length} overall_delta=${result.overall_delta.toFixed(2)} ` +
            `per_answer_deltas=${Object.keys(result.per_answer_deltas).length}`
        );
      } catch (verifyErr) {
        logger.warn(
          `[AI REVIEWER] verification pass failed: ${(verifyErr as Error).message}`
        );
        verification = {
          trigger: triggers.join(','),
          warnings: [],
          threshold: VERIFICATION_HI,
          overall_delta: 0,
          per_answer_deltas: {},
        };
      }
    }

    // Compose narrative + KB citations into the auto-managed AI Reviewer
    // Feedback question's free-text answer.
    const feedbackQuestion = form.questions.find((q) => q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT);
    if (!feedbackQuestion) {
      throw new AIReviewerServiceError(
        `Form ${form.id} is missing the auto-managed "AI Reviewer Feedback" question. Re-save the form in the form builder to repair it.`,
        'FORM_MISSING_AI_FEEDBACK_QUESTION',
        422
      );
    }

    // Route per-category notes into their category's Feedback TEXT
    // question when one exists; unmatched notes plus KB citations fall
    // through to the bottom AI Reviewer Feedback question. Feedback
    // questions are human-text — no confidence score makes sense.
    const { perCategory, unmatched } = composeCategoryFeedback(
      categoryNotes,
      form,
      kbCitations
    );
    const bottomFeedbackText = composeBottomFeedback({
      unmatchedCategoryNotes: unmatched,
      kbCitations,
    });
    const finalAnswers: CreateSubmissionAnswerDTO[] = [
      ...answers,
      ...Array.from(perCategory.entries()).map(([qid, html]) => ({
        question_id: qid,
        answer: html,
      })),
      { question_id: feedbackQuestion.id, answer: bottomFeedbackText },
    ];

    const { csrId, metadata } = await buildSubmissionMetadata({
      formId: form.id,
      agentDisplayName: material.agentDisplayName,
      interactionDate: material.interactionDate,
    });

    const link = adapter.toSubmissionLink(sourceId, material);
    // Calls need a CSR on the materialized Call row; default to the AI
    // Reviewer user when the form metadata didn't resolve one.
    const callCsrId = adapter.kind === 'CALL' ? csrId ?? aiUserId : csrId;

    // Per-answer calibration (Tier-1 Item 3). Same gate as the
    // multi-source path: identity unless AI_REVIEWER_PER_QUESTION_CALIBRATION=1
    // AND the form's active map carries a `by_question[<qid>]` entry.
    for (const a of answers) {
      a.ai_confidence = await applyAnswerCalibration(form.id, a.question_id, a.ai_confidence ?? null);
    }
    // Apply per-form confidence calibration. Identity (calibrated === nominal)
    // until the form has an active ai_calibration_map row. Inbox routing
    // queries `ai_calibrated_confidence` so once the calibrator is fit the
    // routing decision automatically uses the empirically-corrected value.
    const calibratedConfidence = await applyCalibration(form.id, overallConfidence ?? null);

    const payload = {
      form_id: form.id,
      submitted_by: aiUserId,
      csr_id: callCsrId,
      // Single-source path is Anthropic-only today (callClaude is
      // hard-coded). Tag the DRAFT so a future compare on the same case
      // can dedup against this row by provider rather than clobbering it.
      ai_provider: 'anthropic' as const,
      metadata,
      answers: finalAnswers,
      ai_overall_confidence: overallConfidence,
      ai_calibrated_confidence: calibratedConfidence,
      ai_extras: buildAiExtras({
        timeline,
        observations,
        playbookSteps,
        coaching,
        answerEvidence,
        selfConsistencyWarnings,
        verification,
      }),
      ...link,
    };

    logger.info(
      `[AI REVIEWER] form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
        `overall_confidence=${overallConfidence == null ? 'null' : overallConfidence.toFixed(2)} ` +
        `calibrated_confidence=${calibratedConfidence == null ? 'null' : calibratedConfidence.toFixed(2)} ` +
        `timeline_items=${timeline?.length ?? 0} observations=${observations?.length ?? 0}`
    );

    // Phase 5 branch: when the form opts in to ai_submit_as_draft, route
    // through saveDraft so the AI's grade lands as DRAFT (no scoring) and
    // a human reviews + promotes it. Default path stays unchanged.
    if (form.ai_submit_as_draft) {
      const draftResult = await this.submissionService.saveDraft(payload, aiUserId);
      logger.info(
        `[AI REVIEWER] Saved DRAFT submission_id=${draftResult.submission_id} ` +
          `for form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
          `(awaiting human review).`
      );

      // Route-to-QA notification (always fires for AI drafts) + low-confidence
      // notification (only when below threshold). Both go to QAs, never CSR.
      try {
        const csrId = (payload as any).csr_id ?? (payload as any).agent_user_id ?? null;
        const csr = csrId
          ? await prisma.user.findUnique({ where: { id: Number(csrId) }, select: { id: true, username: true } })
          : null;
        const threshold = (form as any).ai_sample_low_confidence_threshold;
        const isLowConfidence =
          overallConfidence != null && threshold != null && Number(overallConfidence) < Number(threshold);
        const { default: notificationService } = await import('./notifications/NotificationService');
        const ctx = {
          entityType: 'submission' as const,
          entityId: draftResult.submission_id,
          deepLinkPath: `/app/quality/ai-inbox`,
        };
        const basePayload = {
          form: { id: form.id, form_name: form.form_name, ai_sample_low_confidence_threshold: threshold },
          submission: {
            id: draftResult.submission_id,
            ai_overall_confidence: overallConfidence,
            total_score: 0,
          },
          csr,
          csrId: csr?.id ?? null,
          routingReason: isLowConfidence ? 'low_confidence' : 'ai_draft_review',
        };
        await notificationService.notify('ai.review_routed_to_qa', basePayload, ctx);
        if (isLowConfidence) {
          await notificationService.notify('ai.review_low_confidence', basePayload, ctx);
        }
      } catch (mailErr) {
        logger.warn('[AI REVIEWER] notify failed (draft still saved)', mailErr);
      }

      return {
        submission_id: draftResult.submission_id,
        total_score: 0,
        status: 'DRAFT',
        message: draftResult.message,
        ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
        kb_pages_cited: kbCitations,
        cost_estimate: costPayload,
      };
    }

    const submitResult = await this.submissionService.submitAudit(payload, aiUserId);

    logger.info(
      `[AI REVIEWER] Submitted audit submission_id=${submitResult.submission_id} ` +
        `for form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
        `score=${submitResult.total_score}`
    );

    return {
      submission_id: submitResult.submission_id,
      total_score: submitResult.total_score,
      status: 'SUBMITTED',
      message: submitResult.message,
      ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
      kb_pages_cited: kbCitations,
      cost_estimate: costPayload,
    };
  }
}

/**
 * Pulls recent human corrections for this form so the prompt builder
 * can inject them as few-shot lessons (closes the calibration feedback
 * loop). Logged at info level on every run so operators can see the
 * loop firing in stdout. Returns [] on any failure — the AI run must
 * never fail because the calibration loop is unavailable.
 */
async function loadCorrectionsForPrompt(
  formId: number,
  classificationText?: string
): Promise<CalibrationCorrection[]> {
  try {
    const corrections = await aiCalibrationService.getRecentCorrections(formId, {
      classificationText,
    });
    if (corrections.length > 0) {
      const totalChars = corrections.reduce(
        (sum, c) =>
          sum +
          c.question_text.length +
          c.ai_value.length +
          c.human_value.length +
          80, // header / label fixed overhead per row
        0
      );
      logger.info(
        `[AI REVIEWER] injected ${corrections.length} learned corrections (~${totalChars} chars) for form_id=${formId}`
      );
    } else {
      logger.info(`[AI REVIEWER] no learned corrections to inject for form_id=${formId}`);
    }
    return corrections;
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] failed to load calibration corrections for form_id=${formId} (continuing without): ${(err as Error).message}`
    );
    return [];
  }
}

/**
 * Loads form definition + validates AI eligibility. Throws on any failure.
 *
 * NOTE: We intentionally do NOT consult `form.interaction_type` here.
 * Per product direction it is informational metadata on the form (so the
 * form list in the builder can group "ticket forms" vs "call forms" for
 * humans) and does NOT gate AI behavior. The actual review path is
 * dictated by the source attached to the run — ticket → ticket review,
 * task → task review, conversation → call review. A QA admin can grade
 * a call against a "ticket" form during calibration without flipping any
 * setting first.
 */
async function loadFormForReview(formId: number): Promise<FormForPrompt & { ai_submit_as_draft: boolean }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      form_categories: {
        include: { form_questions: { include: { radio_options: true } } },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!form) throw new AIReviewerServiceError(`Form ${formId} not found`, 'FORM_NOT_FOUND', 404);
  if (!(form as any).ai_enabled) {
    throw new AIReviewerServiceError(
      `Form ${formId} does not have ai_enabled = true. Enable it in the form builder.`,
      'FORM_NOT_AI_ELIGIBLE',
      403
    );
  }

  const formInteractionType = form.interaction_type as string;

  const questions = form.form_categories.flatMap((c) =>
    c.form_questions.map((q) => ({
      id: q.id,
      category_name: c.category_name,
      question_text: q.question_text,
      question_type: q.question_type as string,
      yes_value: q.yes_value,
      no_value: q.no_value,
      na_value: q.na_value,
      is_na_allowed: q.is_na_allowed,
      radio_options: q.radio_options.map((r) => ({ value: r.option_value, text: r.option_text, score: r.score })),
      // Thread role so prompt renderers can skip ROLLUP questions (the
      // rollup engine writes their answer deterministically; sending them
      // to Claude wastes input+output tokens and the answer would be
      // overwritten anyway).
      role: ((q as { role?: string }).role === 'ROLLUP' ? 'ROLLUP' : 'DETAIL') as 'DETAIL' | 'ROLLUP',
    }))
  );

  return {
    id: form.id,
    form_name: form.form_name,
    interaction_type: formInteractionType,
    ai_review_guidance: ((form as any).ai_review_guidance ?? null) as string | null,
    ai_base_prompt_id: ((form as any).ai_base_prompt_id ?? null) as number | null,
    ai_submit_as_draft: (form as any).ai_submit_as_draft === true,
    categories: form.form_categories.map((c) => ({ id: c.id, category_name: c.category_name })),
    questions,
  };
}

/**
 * Resolves the form's metadata fields for an AI submission:
 *   • Reviewer Name (AUTO)    → "AI Reviewer"
 *   • Review Date  (AUTO)     → today (yyyy-mm-dd)
 *   • CSR          (DROPDOWN) → qtip user.id matched by username == CRM agent display name
 *   • Interaction Date (DATE) → ticket created_on (yyyy-mm-dd)
 * Any other custom metadata fields are left blank — the human can fill them
 * later if needed.
 */
async function buildSubmissionMetadata(args: {
  formId: number;
  agentDisplayName: string | null;
  interactionDate: Date | null;
}): Promise<{ csrId: number | null; metadata: SubmissionMetadataDTO[] }> {
  const fields = await prisma.formMetadataField.findMany({
    where: { form_id: args.formId },
    orderBy: { sort_order: 'asc' },
  });
  if (fields.length === 0) return { csrId: null, metadata: [] };

  const todayIso = new Date().toISOString().slice(0, 10);
  const interactionIso = args.interactionDate ? args.interactionDate.toISOString().slice(0, 10) : '';

  let csrId: number | null = null;
  if (args.agentDisplayName) {
    const matched = await prisma.user.findFirst({
      where: { username: args.agentDisplayName, is_active: true },
      select: { id: true },
    });
    if (matched) {
      csrId = matched.id;
    } else {
      logger.warn(`[AI REVIEWER] Could not match CRM agent "${args.agentDisplayName}" to a qtip user; CSR field will be empty.`);
    }
  }

  const metadata: SubmissionMetadataDTO[] = [];
  for (const f of fields) {
    const name = (f.field_name || '').trim().toLowerCase();
    let value = '';
    if (f.field_type === 'AUTO') {
      if (name.includes('reviewer name') || name.includes('auditor name')) value = 'AI Reviewer';
      else if (name.includes('review date') || name.includes('audit date')) value = todayIso;
    } else if (f.field_type === 'DROPDOWN' && !f.dropdown_source) {
      // user-list dropdown (typically the CSR field)
      if (csrId != null) value = String(csrId);
    } else if (f.field_type === 'DATE') {
      // Substring match so labels like "Agent Interaction Date",
      // "Ticket Date (closed)", or "Task Date" all resolve to the
      // CRM interaction timestamp.
      if (name.includes('interaction date') || name.includes('ticket date') || name.includes('task date')) {
        value = interactionIso;
      }
    }
    if (value) metadata.push({ field_id: f.id, value });
  }
  return { csrId, metadata };
}

interface ClaudeOutput {
  answers: CreateSubmissionAnswerDTO[];
  narrative: string;
  /**
   * Per-category COMMENTARY emitted by the AI. Each entry contains the
   * exact `category_name` from the form spec and a short (1-4 sentence)
   * evidence-anchored note for that category. NOT a verdict / rollup
   * — the scoring engine derives category disposition from the leaf
   * answers. Routed to the form's per-category `Feedback — <Category>`
   * TEXT question when one exists; unmatched entries fall through to
   * the bottom `AI Reviewer Feedback` field. Empty array when the
   * model emitted nothing.
   */
  categoryNotes: { category: string; notes: string }[];
  kbCitations: { id: number; name: string; url: string }[];
  /** Top-level confidence the AI emits for the whole review (0..1, null if not provided). */
  overallConfidence: number | null;
  /** AI-reconstructed chronological action timeline (empty array if none). */
  timeline: AiTimelineItem[];
  /** Non-scored advisory observations (empty array if none). */
  observations: AiObservation[];
  /** Phase A: explicit playbook checklist emitted before answers (empty array if not provided). */
  playbookSteps: AiPlaybookStep[];
  /** Phase A: SPIN-style coaching block (empty arrays when nothing to say). */
  coaching: AiCoaching;
  /** Phase A: per-answer evidence keyed by question_id. */
  answerEvidence: Record<number, { evidence_source?: string; evidence_quote?: string }>;
  /** Phase A: self-consistency warnings detected at parse time. Empty when consistent. */
  selfConsistencyWarnings: string[];
  /** TEMP COST ESTIMATOR — non-persistent USD cost estimate; null when tokens unknown. */
  cost: CostEstimate | null;
}

interface LlmOutput extends ClaudeOutput {
  model: string;
  retried: boolean;
}

/**
 * Provider-aware LLM dispatcher used by the analyzeTicket() path.
 * The production reviewClosedTicket() path still goes through callClaude()
 * directly to keep its diff minimal and behavior unchanged.
 */
async function callLlm(
  provider: AiProvider,
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  if (provider === 'openai') return callOpenAI(promptParts, form, traceCtx);
  return callAnthropic(promptParts, form, traceCtx);
}

/**
 * Anthropic variant. Mirrors callClaude() but returns the model + retried
 * flag for the analysis path. Wrapped in withCallLog so every invocation
 * lands a trace row in ai_call_logs (Phase 3).
 */
async function callAnthropic(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  return withCallLog<LlmOutput>(
    traceCtx ?? { provider: 'anthropic', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model = aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create(
          {
            model,
            // 16000 (was 8000): see callClaude — same large-form truncation
            // risk on the analyzeTicket sandbox path.
            max_tokens: 16000,
            // Phase A: Anthropic deprecated the `temperature` parameter on
            // opus-4-7+ (sending it returns 400). The model is deterministic
            // by default at the API level, so re-running the same ticket
            // still produces the same answers — we just no longer set the
            // value explicitly.
            system: promptParts.system + (extraSystem ?? ''),
            messages: [{ role: 'user', content: promptParts.user }],
          },
          // Per-call 10-minute override + no SDK retries. See callClaude
          // for the full reasoning.
          { timeout: 600_000, maxRetries: 0 }
        );
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        const textBlock = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        if (!textBlock) throw new Error('Claude returned no text content');
        return textBlock.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First Anthropic response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError('Anthropic failed to return valid JSON after one retry.', 'AI_OUTPUT_INVALID', 502);
      }
      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost, model, retried },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * OpenAI variant. Uses chat.completions with response_format json_object
 * which guarantees the model returns a parseable JSON object on the first
 * try (the JSON-retry fallback is still present for safety). Wrapped in
 * withCallLog so every invocation lands a trace row in ai_call_logs
 * (Phase 3).
 */
async function callOpenAI(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  return withCallLog<LlmOutput>(
    traceCtx ?? { provider: 'openai', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getOpenAIClient();
      const model = aiConfig.openai?.defaultModel ?? 'gpt-5';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string): Promise<string> => {
        const res = await client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          // Phase A: temperature 0 for deterministic grading.
          temperature: 0,
          messages: [
            { role: 'system', content: promptParts.system + (extraSystem ?? '') },
            { role: 'user', content: promptParts.user },
          ],
        });
        const usage = res.usage;
        if (usage) {
          tokensIn = usage.prompt_tokens ?? null;
          tokensOut = usage.completion_tokens ?? null;
        }
        return res.choices[0]?.message?.content ?? '';
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First OpenAI response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError('OpenAI failed to return valid JSON after one retry.', 'AI_OUTPUT_INVALID', 502);
      }
      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost, model, retried },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass-1 trace call for the multi-source orchestrator. Returns the raw
 * JSON string that the synthesis pass embeds verbatim into its prompt.
 *
 * Why a separate wrapper from `callClaude`: the trace prompt's response
 * shape is `{ playbook_steps, timeline, observations, extracted_claims,
 * per_question_evidence }` — no `answers[]`. Routing it through
 * `callClaude` would trip `mapClaudeOutputToAnswers`'s "missing answers
 * field" guard. Instead we keep this wrapper minimal: send + retry once
 * if the response isn't JSON, hand the JSON STRING back to the caller.
 *
 * Model selection: `resolveCheapModelName(provider)` — Anthropic
 * resolves to `ANTHROPIC_CHEAP_MODEL` (Haiku), OpenAI resolves to
 * `OPENAI_CHEAP_MODEL`. The trace pass is the labour-intensive bulk
 * read where cheap-model latency + cost dominate.
 *
 * Provider parity (workstream G): this used to hardcode Anthropic so
 * both compare runs traced on Claude, which made the Claude-vs-GPT
 * compare "same trace, different reasoner" rather than truly
 * end-to-end. The `provider` argument flows from `reviewCase`'s
 * `synthesisProvider` so each compare run drives all three passes
 * independently.
 */
async function runTracePass(
  promptParts: { system: string; user: string },
  traceCtx: CallLogMeta,
  provider: ModelProvider = 'anthropic'
): Promise<string> {
  return withCallLog<string>(
    { ...traceCtx, provider },
    promptParts,
    async () => {
      const model = resolveCheapModelName(provider);
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let lastStopReason: string | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const out = await callChatModel(provider, {
          system: promptParts.system + (extraSystem ?? ''),
          user: promptParts.user,
          model,
          // 8000: same headroom as today's Anthropic-only trace; same
          // truncation guard, same zero cost on normal runs.
          maxTokens: 8000,
          // 10-min ceiling matches the reasoning pass; a fan-out of K
          // parallel traces on Sonnet historically settles in under a
          // minute, but slow networks or first-call cold starts have
          // pushed past 5 min on rare occasions.
          timeoutMs: 600_000,
          // JSON mode is honored by OpenAI (and ignored by Anthropic),
          // mirroring the contract the chunk pass uses — keeps trace
          // output schema-clean across providers.
          responseFormat: 'json_object',
        });
        tokensIn = out.tokensIn;
        tokensOut = out.tokensOut;
        lastStopReason = out.stopReason;
        if (!out.text) {
          throw new Error(`${provider} trace response had no text content`);
        }
        return out.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn(
          `[AI REVIEWER] Trace response was not valid JSON; retrying once with stricter system prompt. ` +
            `provider=${provider} stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length}`
        );
        raw = await sendOnce(
          '\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.'
        );
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError(
          `${provider} trace pass failed to return valid JSON after one retry.`,
          'AI_OUTPUT_INVALID',
          502
        );
      }

      // We intentionally hand back the RAW JSON STRING (not the parsed
      // object) — the synthesis prompt embeds it verbatim so the model
      // sees the literal field names from Pass 1. Re-stringifying a
      // parsed object would silently change formatting.
      const cleaned = JSON.stringify(parsed);
      return {
        result: cleaned,
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass 2A of the chunked synthesis pipeline. Runs on Opus and emits
 * the reasoning artefacts only (playbook_steps + timeline + observations
 * + faithfulness + narrative + coaching + kb_citations + overall_confidence)
 * — no `answers[]`. The result is handed off as raw JSON to the
 * parallel Pass-2B answer chunks so each chunk can defer to it as
 * authoritative grading context.
 *
 * Why a separate wrapper from `callClaude`: that wrapper runs
 * `mapClaudeOutputToAnswers` on its result and would trip on the
 * missing `answers[]` field. This wrapper just returns the parsed
 * reasoning object plus its raw JSON string (the chunks embed the
 * latter verbatim in their user prompts).
 *
 * Shares timing/retry behaviour with `callClaude` so big forms have
 * the same generous wall-clock budget on the heavy reasoning step.
 */
async function runReasoningPass(
  promptParts: { system: string; user: string },
  traceCtx: CallLogMeta,
  provider: ModelProvider = 'anthropic',
  /**
   * Optional explicit model override. When set, takes precedence over
   * the provider's env-resolved default. Used by the Sonnet-vs-Opus
   * compare button so each lane runs on a specific Anthropic model
   * without touching the form column.
   */
  modelOverride?: string
): Promise<{ parsed: any; raw: string }> {
  return withCallLog<{ parsed: any; raw: string }>(
    { ...traceCtx, provider },
    promptParts,
    async () => {
      const model = resolveModelName(provider, modelOverride);
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let lastStopReason: string | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const out = await callChatModel(provider, {
          system: promptParts.system + (extraSystem ?? ''),
          user: promptParts.user,
          model,
          // Reasoning artefacts + draft_answers[] for every gradeable
          // question (W1 source-of-truth refactor) push output well past
          // the old 8k ceiling — Opus has been observed truncating at
          // raw_len ~16.8k chars on the largest forms. 16000 is the new
          // baseline; OpenAI gets an additional REASONING_HEADROOM on top
          // inside ChatModelClient to cover internal reasoning burn.
          maxTokens: 16000,
          timeoutMs: 600_000,
          // JSON mode is OFF for BOTH providers on the reasoning pass
          // so the Claude-vs-ChatGPT compare is symmetric — every input
          // and every parameter is identical, only the model name
          // differs. Anthropic already ignored response_format (the
          // system prompt enforces JSON), so removing it is a no-op for
          // the Claude path. For OpenAI it lets gpt-5/5.5 narrate
          // freely before converging to JSON instead of being skewed
          // toward "fill the schema." The retry-once-on-bad-JSON safety
          // net below catches the rare case where either model wraps
          // the JSON in surrounding prose.
          //
          // Chunk pass (runAnswerChunkPass) keeps JSON mode on because
          // its output is small (~3-4k chars) and purely structural —
          // there's no narrative for the model to compress.
          responseFormat: undefined,
        });
        tokensIn = out.tokensIn;
        tokensOut = out.tokensOut;
        lastStopReason = out.stopReason;
        if (!out.text) {
          throw new Error(`${provider} reasoning response had no text content`);
        }
        return out.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn(
          `[AI REVIEWER] Reasoning pass: first response was not valid JSON; retrying. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length}`
        );
        raw = await sendOnce(
          '\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.'
        );
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError(
          'Reasoning pass failed to return valid JSON after one retry.',
          'AI_OUTPUT_INVALID',
          502
        );
      }

      // Re-stringify so chunks embed a normalized JSON form (no
      // markdown fences, no leading prose). The original raw string is
      // returned via rawResponse for the call-log record.
      const cleanedJson = JSON.stringify(parsed);
      return {
        result: { parsed, raw: cleanedJson },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass 2B of the chunked synthesis pipeline: ONE answer chunk for ONE
 * form category. Runs on Sonnet (~3-5x faster, ~5x cheaper than Opus).
 * The model has been told to defer to the reasoning pass's artefacts;
 * this call just translates them into verdicts for the listed
 * question_ids.
 *
 * Returns the parsed `answers[]` array (raw — `mapClaudeOutputToAnswers`
 * does the per-question validation downstream once all chunks are
 * merged). Throws AI_OUTPUT_INVALID with the chunk's category name
 * embedded in the message if Sonnet can't produce parseable JSON,
 * which mirrors how a single-pass synthesis failure surfaces today.
 */
async function runAnswerChunkPass(
  promptParts: { system: string; user: string },
  traceCtx: CallLogMeta,
  categoryName: string,
  provider: ModelProvider = 'anthropic',
  form?: FormForPrompt,
  allowedQuestionIds?: number[]
): Promise<any[]> {
  return withCallLog<any[]>(
    { ...traceCtx, provider },
    promptParts,
    async () => {
      // Cheap-model env contract is per-provider: ANTHROPIC_CHEAP_MODEL
      // for Anthropic, OPENAI_CHEAP_MODEL for OpenAI. resolveCheapModelName
      // centralizes the lookup so the synthesis path doesn't have to
      // know about either env var directly.
      const model = resolveCheapModelName(provider);
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let lastStopReason: string | null = null;

      // Tool-use mode (Anthropic only): force the model to emit answers
      // through a `submit_answers` tool whose input_schema constrains
      // `value` per question_id (RADIO/MULTI_SELECT enum, YES_NO yes/no,
      // SCALE integer). Anthropic's API rejects model outputs that
      // don't match the schema, so the historical "value = 'yes' on a
      // RADIO" failure mode becomes physically impossible.
      const useTool = provider === 'anthropic' && form != null && allowedQuestionIds != null;
      const tool = useTool
        ? buildAnswersTool(form!, allowedQuestionIds!, 'answers_chunk')
        : null;

      const sendOnce = async (extraSystem?: string) => {
        const out = await callChatModel(provider, {
          system: promptParts.system + (extraSystem ?? ''),
          user: promptParts.user,
          model,
          // 8000: an answers-only chunk for ~15 questions is ~3-4k
          // chars / ~1.5k tokens. 8k leaves comfortable headroom for
          // the largest plausible category without paying for output
          // we'll never use.
          maxTokens: 8000,
          // 5-min per-chunk timeout. Sonnet / GPT-5-mini both complete
          // a chunk in ~30-90 sec; 5 min is paranoia-level headroom for
          // a slow network hiccup. Orchestrator owns retry semantics.
          timeoutMs: 300_000,
          responseFormat: 'json_object',
          ...(tool
            ? {
                tools: [tool],
                toolChoice: { type: 'tool' as const, name: 'submit_answers' },
              }
            : {}),
        });
        tokensIn = out.tokensIn;
        tokensOut = out.tokensOut;
        lastStopReason = out.stopReason;
        if (tool) {
          // Tool path: the model is forced to call `submit_answers`;
          // toolInput is the validated arguments object.
          const ti = out.toolInput as { answers?: unknown } | null;
          if (!ti || !Array.isArray(ti.answers)) {
            throw new Error(
              `${provider} answer-chunk tool call returned no answers[] payload (toolInput=${JSON.stringify(ti).slice(0, 200)})`
            );
          }
          return { rawText: JSON.stringify(ti), answers: ti.answers as any[] };
        }
        if (!out.text) {
          throw new Error(`${provider} answer-chunk response had no text content`);
        }
        return { rawText: out.text, answers: null as any[] | null };
      };

      const first = await sendOnce();
      let raw = first.rawText;
      let answersArr: any[] | null = first.answers;
      if (answersArr == null) {
        // Free-text JSON path (OpenAI / no-tool fallback): parse + retry-on-fail.
        let parsed = tryParseJson(raw);
        if (!parsed) {
          retried = true;
          logger.warn(
            `[AI REVIEWER] Answer chunk "${categoryName}": first response was not valid JSON; retrying. ` +
              `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length}`
          );
          const retry = await sendOnce(
            '\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.'
          );
          raw = retry.rawText;
          parsed = tryParseJson(raw);
        }
        if (!parsed || !Array.isArray(parsed.answers)) {
          throw new AIReviewerServiceError(
            `Answer chunk "${categoryName}" failed to return a valid answers[] array after one retry.`,
            'AI_OUTPUT_INVALID',
            502
          );
        }
        answersArr = parsed.answers as any[];
      }

      return {
        result: answersArr,
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass 2C of the chunked synthesis pipeline: reconcile a SINGLE
 * dissented answer. Called only for questions where the chunk pass
 * (Pass 2B) flagged `dissent: true` — i.e. the chunk model is
 * claiming the rubric + evidence clearly contradict the reasoning
 * pass's draft verdict.
 *
 * Sends a tiny call with: the question text + rubric, the draft
 * verdict + brief_rationale (from the reasoning pass), the chunk's
 * dissenting verdict + dissent_reason + evidence quote, and the
 * narrative excerpt for the category. Returns a single verdict +
 * one-sentence rationale.
 *
 * Falls back to the reasoning draft verdict if the API call fails —
 * we prefer the holistic-context view (reasoning) over the siloed
 * view (chunk) on any error, on the principle that the reasoning
 * pass saw the entire case and the chunk only saw one category.
 */
async function runReconciliationPass(
  args: {
    questionId: number;
    questionText: string;
    rubricMd: string | null;
    draftVerdict: 'yes' | 'no' | 'na';
    draftRationale: string;
    chunkVerdict: 'yes' | 'no' | 'na';
    chunkDissentReason: string;
    chunkEvidenceQuote: string;
    narrativeExcerpt: string;
  },
  traceCtx: CallLogMeta,
  provider: ModelProvider
): Promise<{ verdict: 'yes' | 'no' | 'na'; rationale: string }> {
  const system =
    'You are a quality-assurance arbiter. Two AI passes disagreed on one question. ' +
    'You will receive (a) the question and its rubric, (b) the reasoning pass\'s DRAFT verdict + rationale, ' +
    '(c) the chunk pass\'s DISSENTING verdict + reason + evidence quote, (d) the narrative excerpt for context. ' +
    'Apply the rubric strictly. Pick the verdict that the rubric + evidence most clearly supports. ' +
    'Tie-break in favor of the reasoning pass (it saw the entire case; the chunk only saw one category). ' +
    'Respond with ONE JSON object: {"verdict":"yes"|"no"|"na","rationale":"<one short sentence>"}. ' +
    'NO prose outside the JSON, NO markdown.';
  const user = [
    `QUESTION q${args.questionId}: ${args.questionText}`,
    '',
    'RUBRIC:',
    args.rubricMd ?? '(no rubric configured)',
    '',
    `DRAFT VERDICT (reasoning pass): ${args.draftVerdict.toUpperCase()}`,
    `DRAFT RATIONALE: ${args.draftRationale}`,
    '',
    `CHUNK VERDICT (dissenting): ${args.chunkVerdict.toUpperCase()}`,
    `CHUNK DISSENT REASON: ${args.chunkDissentReason}`,
    `CHUNK EVIDENCE QUOTE: ${args.chunkEvidenceQuote || '(no quote)'}`,
    '',
    'NARRATIVE EXCERPT (for context):',
    args.narrativeExcerpt || '(none)',
  ].join('\n');

  try {
    return await withCallLog<{ verdict: 'yes' | 'no' | 'na'; rationale: string }>(
      { ...traceCtx, provider },
      { system, user },
      async () => {
        const model = resolveCheapModelName(provider);
        const out = await callChatModel(provider, {
          system,
          user,
          model,
          // 256 tokens: a verdict + one-sentence rationale is ~40 chars.
          // Give plenty of headroom for the reasoning-model overhead but
          // not so much that one reconciliation costs as much as a chunk.
          maxTokens: 1000,
          timeoutMs: 120_000,
          responseFormat: 'json_object',
        });
        const parsed = tryParseJson(out.text);
        if (!parsed || typeof parsed.verdict !== 'string') {
          throw new Error('reconciliation response missing verdict');
        }
        const v = String(parsed.verdict).toLowerCase();
        if (v !== 'yes' && v !== 'no' && v !== 'na') {
          throw new Error(`reconciliation returned invalid verdict: ${parsed.verdict}`);
        }
        return {
          result: {
            verdict: v as 'yes' | 'no' | 'na',
            rationale: String(parsed.rationale ?? '').trim() || 'reconciled (no rationale)',
          },
          model,
          rawResponse: out.text,
          retried: false,
          tokensIn: out.tokensIn,
          tokensOut: out.tokensOut,
        };
      }
    );
  } catch (err) {
    // Fail-safe: when reconciliation breaks, defer to the holistic
    // reasoning view rather than the siloed chunk view. This is the
    // OPPOSITE of "keep the chunk's NO" — which is precisely the
    // failure mode this refactor is trying to eliminate.
    logger.warn(
      `[AI REVIEWER] reconciliation q${args.questionId} failed (${(err as Error).message}); ` +
        `falling back to reasoning draft verdict=${args.draftVerdict}`
    );
    return {
      verdict: args.draftVerdict,
      rationale: `reconciliation unavailable; deferred to reasoning draft: ${args.draftRationale}`,
    };
  }
}

/**
 * Orchestrate the chunked synthesis pipeline:
 *   1. Build + run the reasoning prompt on Opus (Pass 2A) — emits
 *      playbook_steps + timeline + observations + faithfulness +
 *      narrative + coaching + kb_citations + overall_confidence
 *      AND `draft_answers[]` (one per gradeable question_id).
 *   2. Group the form's gradeable questions by category, build one
 *      answer-chunk prompt per category (Pass 2B), fire them all in
 *      parallel. Each chunk receives its category's draft verdicts
 *      and produces final answers (confirm + attach evidence, or
 *      flag dissent).
 *   3. Reconcile: for every chunk answer where `dissent === true`,
 *      run a tiny reconciliation call (Pass 2C) that resolves the
 *      disagreement. Skipped entirely when no dissents (zero-cost on
 *      healthy runs).
 *   4. Merge: stitch reasoning + (chunk OR reconciled) answers and
 *      hand the result to `mapClaudeOutputToAnswers`.
 *
 * Cost: each pass writes its own `ai_call_logs` row (one for
 * reasoning, N for the per-category chunks, M for reconciliations
 * where M = number of dissents) and contributes to the `cost`
 * accumulator so the existing rollup picks them up.
 */
async function runChunkedSynthesis(
  synthesisInput: Parameters<typeof buildReasoningPrompt>[0],
  form: FormForPrompt,
  opts: {
    formId: number;
    caseId: string;
    ticketId: number | null;
    accumulateCost: (passLabel: string) => (cost: CostEstimate | null) => void;
    /**
     * Provider override for THIS synthesis run. Defaults to the form's
     * configured `ai_model_provider`. Set explicitly by the
     * compare-models endpoint to force a specific provider per side
     * without touching the form column.
     */
    provider?: ModelProvider;
    /**
     * Optional reasoning-pass model override. Forwarded to
     * `runReasoningPass` so the Sonnet-vs-Opus compare can swap the
     * default Anthropic model per lane. Answer-chunk + reconcile
     * passes are unaffected (they always use the cheap model).
     */
    reasoningModelOverride?: string;
  }
): Promise<ClaudeOutput> {
  const provider: ModelProvider = opts.provider ?? 'anthropic';
  const reasoningPrompt = buildReasoningPrompt(synthesisInput);
  const reasoningCtx: CallLogMeta = {
    provider,
    purpose: 'ai_reviewer.case.synthesis.reasoning',
    pass: 'syn_reasoning',
    ticketId: opts.ticketId,
    formId: opts.formId,
    caseId: opts.caseId,
    onCost: opts.accumulateCost('synthesis_reasoning'),
  };
  const { parsed: reasoningParsed, raw: reasoningJson } = await runReasoningPass(
    reasoningPrompt,
    reasoningCtx,
    provider,
    opts.reasoningModelOverride
  );

  const categories = groupGradeableQuestionsByCategory(form);
  if (categories.length === 0) {
    throw new AIReviewerServiceError(
      `Form ${opts.formId} has no gradeable categories — chunked synthesis cannot run.`,
      'AI_OUTPUT_INVALID',
      502
    );
  }

  // Parse `draft_answers[]` from the reasoning output into a flat map.
  // The reasoning addendum REQUIRES one draft per gradeable question;
  // any missing ids will surface as MISSING in the chunk prompt and
  // the chunk model will fall back to its rubric reading.
  const draftAnswersById = parseDraftAnswers(reasoningParsed);
  const draftCount = draftAnswersById.size;
  const gradeableCount = categories.reduce((acc, c) => acc + c.questionIds.length, 0);
  if (draftCount < gradeableCount) {
    logger.warn(
      `[AI REVIEWER] reasoning pass emitted ${draftCount} draft_answers but form has ` +
        `${gradeableCount} gradeable questions (case=${opts.caseId}, form=${opts.formId}); ` +
        `${gradeableCount - draftCount} questions will fall back to rubric-only chunk grading`
    );
  }

  // Fan out: one cheap-model call per category in parallel. Each chunk
  // gets its draft verdicts (so it can confirm + attach evidence rather
  // than independently re-grade) plus the full reasoning JSON and per-
  // source traces for evidence anchoring. Promise.all keeps wall time
  // at one chunk; cost is N chunks.
  const chunkResults = await Promise.all(
    categories.map(({ category, questionIds }) => {
      const draftsForChunk: DraftAnswer[] = [];
      for (const qid of questionIds) {
        const d = draftAnswersById.get(qid);
        if (d) draftsForChunk.push(d);
      }
      const chunkPrompt = buildAnswerChunkPrompt({
        form,
        categoryName: category,
        questionIds,
        reasoning: { reasoningJson },
        draftAnswers: draftsForChunk,
        traces: synthesisInput.traces,
        corrections: synthesisInput.corrections,
        pivots: synthesisInput.pivots,
        traceAgreements: synthesisInput.traceAgreements,
        kbAnchors: synthesisInput.kbAnchors,
      });
      const chunkCtx: CallLogMeta = {
        provider,
        purpose: 'ai_reviewer.case.synthesis.answer_chunk',
        pass: 'syn_answers',
        ticketId: opts.ticketId,
        formId: opts.formId,
        caseId: opts.caseId,
        onCost: opts.accumulateCost(`synthesis_answers:${category}`),
      };
      return runAnswerChunkPass(chunkPrompt, chunkCtx, category, provider, form, questionIds);
    })
  );

  const mergedAnswers = chunkResults.flat();

  // Reconcile dissents. The chunk model is instructed to set
  // `dissent: true` ONLY when the rubric+evidence clearly contradicts
  // the draft. In a healthy run this fires on 0-5% of questions.
  const narrativeExcerpt = extractNarrative(reasoningParsed);
  const formQuestionsById = new Map<number, FormForPrompt['questions'][number]>();
  for (const q of form.questions) formQuestionsById.set(q.id, q);
  const rubricsById = loadFormRubrics(opts.formId);

  const dissentIndexes: number[] = [];
  for (let i = 0; i < mergedAnswers.length; i++) {
    if (mergedAnswers[i] && mergedAnswers[i].dissent === true) dissentIndexes.push(i);
  }

  if (dissentIndexes.length > 0) {
    logger.info(
      `[AI REVIEWER] chunked synthesis dissents detected: ${dissentIndexes.length} ` +
        `(case=${opts.caseId}, form=${opts.formId}); running reconciliation pass`
    );
    const reconcileCtx: CallLogMeta = {
      provider,
      purpose: 'ai_reviewer.case.synthesis.reconcile',
      pass: 'syn_reconcile',
      ticketId: opts.ticketId,
      formId: opts.formId,
      caseId: opts.caseId,
      onCost: opts.accumulateCost('synthesis_reconcile'),
    };
    const reconciliations = await Promise.all(
      dissentIndexes.map(async (idx) => {
        const chunkAns = mergedAnswers[idx];
        const qid = Number(chunkAns.question_id);
        const draft = draftAnswersById.get(qid);
        const q = formQuestionsById.get(qid);
        const rubric = rubricsById.get(qid) ?? null;
        return runReconciliationPass(
          {
            questionId: qid,
            questionText: q?.question_text ?? '(unknown question)',
            rubricMd: rubric,
            draftVerdict: (draft?.verdict ?? 'no') as 'yes' | 'no' | 'na',
            draftRationale: draft?.brief_rationale ?? '(no draft rationale)',
            chunkVerdict: String(chunkAns.value ?? chunkAns.answer ?? 'no').toLowerCase() as 'yes' | 'no' | 'na',
            chunkDissentReason: String(chunkAns.dissent_reason ?? '(no reason given)'),
            chunkEvidenceQuote: String(chunkAns.evidence_quote ?? ''),
            narrativeExcerpt,
          },
          reconcileCtx,
          provider
        );
      })
    );
    for (let i = 0; i < dissentIndexes.length; i++) {
      const idx = dissentIndexes[i];
      const r = reconciliations[i];
      // Apply reconciled verdict; preserve chunk's evidence quote;
      // average confidence between draft (high signal of holistic
      // view) and chunk (high signal of literal rubric reading).
      const draft = draftAnswersById.get(Number(mergedAnswers[idx].question_id));
      const draftConf = 0.85;
      const chunkConf = Number(mergedAnswers[idx].confidence ?? 0.5);
      mergedAnswers[idx] = {
        ...mergedAnswers[idx],
        value: r.verdict,
        answer: r.verdict,
        confidence: Number(((draftConf + chunkConf) / 2).toFixed(2)),
        reconciled: true,
        reconciled_from: {
          draft: draft?.verdict ?? null,
          chunk: mergedAnswers[idx].value ?? mergedAnswers[idx].answer ?? null,
        },
        reconciliation_rationale: r.rationale,
      };
    }
  }

  // For non-dissented answers, force value to the draft verdict (the
  // chunk model is supposed to confirm; if it accidentally emitted a
  // different verdict without setting dissent=true, that's a chunk
  // protocol violation and we trust the reasoning pass). The chunk's
  // evidence_quote / evidence_source are preserved either way.
  let confirmedFromDraft = 0;
  let chunkOverrodeWithoutDissent = 0;
  for (let i = 0; i < mergedAnswers.length; i++) {
    const a = mergedAnswers[i];
    if (a.reconciled === true) continue;
    if (a.dissent === true) continue; // already handled above
    const draft = draftAnswersById.get(Number(a.question_id));
    if (!draft) continue; // no draft available; trust chunk's rubric reading
    const chunkVerdict = String(a.value ?? a.answer ?? '').toLowerCase();
    if (chunkVerdict !== draft.verdict) {
      chunkOverrodeWithoutDissent++;
      // Force back to draft (silent protocol violation).
      mergedAnswers[i] = {
        ...a,
        value: draft.verdict,
        answer: draft.verdict,
        overridden_from_draft: true,
      };
    } else {
      confirmedFromDraft++;
    }
  }

  const mergedParsed = { ...reasoningParsed, answers: mergedAnswers };

  logger.info(
    `[AI REVIEWER] chunked synthesis assembled (case=${opts.caseId}, form=${opts.formId}, ` +
      `categories=${categories.length}, total_answers=${mergedAnswers.length}, ` +
      `drafts=${draftCount}, confirmed=${confirmedFromDraft}, dissents=${dissentIndexes.length}, ` +
      `silent_overrides=${chunkOverrodeWithoutDissent})`
  );

  return mapClaudeOutputToAnswers(mergedParsed, form);
}

/**
 * Parse `draft_answers[]` out of a reasoning pass's parsed JSON into
 * a flat `Map<question_id, DraftAnswer>`. Tolerant of mild schema
 * drift (the model occasionally normalises `verdict` casing or uses
 * `answer` instead of `verdict`).
 */
function parseDraftAnswers(reasoningParsed: any): Map<number, DraftAnswer> {
  const out = new Map<number, DraftAnswer>();
  const raw = reasoningParsed?.draft_answers;
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const qid = Number(item.question_id);
    if (!Number.isFinite(qid)) continue;
    const verdictRaw = String(item.verdict ?? item.answer ?? '').toLowerCase().trim();
    if (verdictRaw !== 'yes' && verdictRaw !== 'no' && verdictRaw !== 'na') continue;
    out.set(qid, {
      question_id: qid,
      verdict: verdictRaw as 'yes' | 'no' | 'na',
      brief_rationale: String(item.brief_rationale ?? item.rationale ?? '').trim(),
      evidence_pointer: item.evidence_pointer && typeof item.evidence_pointer === 'object'
        ? {
            source_kind: item.evidence_pointer.source_kind ? String(item.evidence_pointer.source_kind) : undefined,
            source_id: item.evidence_pointer.source_id ? String(item.evidence_pointer.source_id) : undefined,
            where: item.evidence_pointer.where ? String(item.evidence_pointer.where) : undefined,
          }
        : undefined,
    });
  }
  return out;
}

/**
 * Pull a short narrative excerpt from the reasoning JSON for the
 * reconciliation prompt. We don't need the full coaching block —
 * just enough context for the arbiter to understand the case.
 */
function extractNarrative(reasoningParsed: any): string {
  const n = reasoningParsed?.narrative;
  if (typeof n === 'string') return n.slice(0, 2000);
  if (Array.isArray(n)) return n.join('\n').slice(0, 2000);
  return '';
}

/**
 * Production-path Claude call (used by review() to actually persist a
 * submission). Wrapped in withCallLog so every prod review writes a trace
 * row to ai_call_logs (Phase 3).
 */
async function callClaude(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<ClaudeOutput> {
  return withCallLog<ClaudeOutput>(
    traceCtx ?? { provider: 'anthropic', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model = aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      let lastStopReason: string | null = null;

      // Tool-use mode for the single-source path: force the answers
      // pass through the same `submit_answers` JSON-schema tool the
      // chunked path uses, so RADIO / MULTI_SELECT / YES_NO values are
      // schema-validated at the API. Narrative + reasoning artefacts
      // (playbook_steps, timeline, observations, coaching,
      // category_notes, kb_citations, overall_confidence) still come
      // back as a free-text JSON block in the same assistant turn —
      // Anthropic supports text + tool_use blocks side by side.
      const gradeableIds = getGradeableQuestionIds(form);
      const answersTool = buildAnswersTool(form, gradeableIds, 'single_source');

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create(
          {
            // 16000 (was 8000): a 114-question form (Contact Call Review v2
            // AI Pilot, form 99018) blew past the 8000 cap because the
            // synthesis schema requires playbook_steps + timeline +
            // observations + 100+ answers + faithfulness + coaching +
            // narrative — easily 30k+ chars. The cap is a ceiling — Claude
            // only emits what it needs — so the extra headroom costs
            // nothing on shorter forms. Opus 4.7 supports up to 32k
            // output tokens; 16000 leaves headroom without paying for
            // every form to be billed at 32k.
            model,
            max_tokens: 16000,
            // Phase A: deterministic grading is now provided by the model
            // by default (Anthropic deprecated the temperature parameter).
            system: promptParts.system + (extraSystem ?? ''),
            messages: [{ role: 'user', content: promptParts.user }],
            tools: [answersTool] as unknown as Parameters<typeof client.messages.create>[0]['tools'],
            tool_choice: { type: 'tool', name: 'submit_answers' } as unknown as Parameters<typeof client.messages.create>[0]['tool_choice'],
          },
          {
            // The shared client uses ANTHROPIC_TIMEOUT_MS (~120s) which is
            // sized for short ticket reviews. The production answer-emitting
            // call on a large form (e.g. 99018 with 114 questions ⇒ ~16k
            // output tokens) takes longer than that to stream — Opus runs at
            // ~2-3k output tokens/min on big JSON. Override per-call to 10
            // minutes so big forms can complete; small forms still finish
            // fast and cost the same.
            timeout: 600_000,
            // No SDK-level retries here: a 10-minute timeout × 2 SDK retries
            // would silently turn into a 30-minute hang. The outer
            // sendOnce/parse-retry loop is the only retry layer we want.
            maxRetries: 0,
          }
        );
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        lastStopReason =
          (res as { stop_reason?: string | null }).stop_reason ?? null;
        const textBlock = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        const toolBlock = res.content.find((b) => b.type === 'tool_use') as
          | { type: 'tool_use'; name: string; input: { answers?: unknown } }
          | undefined;
        if (!toolBlock) throw new Error('Claude returned no tool_use block for submit_answers');
        return { text: textBlock?.text ?? '', toolInput: toolBlock.input };
      };

      let { text: raw, toolInput } = await sendOnce();
      // The text block carries narrative + reasoning artefacts (no
      // answers). Parse it; on failure, fall back to a minimal object
      // and rely on the tool's `answers[]`. The retry is still useful
      // because reasoning fields drive verification + coaching.
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn(
          `[AI REVIEWER] First Claude text block was not valid JSON; retrying once with stricter system prompt. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length} ` +
            `head=${JSON.stringify(raw.slice(0, 400))} tail=${JSON.stringify(raw.slice(-400))}`
        );
        const retry = await sendOnce('\n\nIMPORTANT: Your previous text block could not be parsed as JSON. Emit a SINGLE JSON object in the text block (no prose, no code fences) AND call the submit_answers tool with the answers.');
        raw = retry.text;
        toolInput = retry.toolInput;
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        logger.error(
          `[AI REVIEWER] Claude retry text block ALSO failed JSON parse. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length} ` +
            `head=${JSON.stringify(raw.slice(0, 400))} tail=${JSON.stringify(raw.slice(-400))}`
        );
        // Degrade gracefully: the tool's answers[] is the authoritative
        // grading payload anyway; the missing text block just costs us
        // narrative + reasoning artefacts. Build a minimal envelope so
        // mapClaudeOutputToAnswers + downstream coaching don't NPE.
        parsed = {};
      }

      // Merge: answers[] comes from the tool (schema-validated);
      // everything else (narrative, reasoning artefacts, coaching,
      // category_notes) comes from the text block.
      const ti = toolInput as { answers?: unknown } | null;
      const toolAnswers = ti && Array.isArray(ti.answers) ? (ti.answers as any[]) : [];
      const merged = { ...parsed, answers: toolAnswers };
      const out = mapClaudeOutputToAnswers(merged, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Strip optional markdown fences and parse the first balanced JSON
 * object out of an LLM response. Exported so sibling LLM-call modules
 * (e.g. the pivot detector) can reuse the same lenient parsing rules
 * without duplicating the regex/fallback logic.
 */
function mapClaudeOutputToAnswers(parsed: any, form: FormForPrompt): ClaudeOutput {
  if (!parsed || !Array.isArray(parsed.answers)) {
    throw new AIReviewerServiceError('Claude response missing required field: answers[].', 'AI_OUTPUT_INVALID', 502);
  }

  // Map by question_id → expected answer space, validate every answered question.
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  const answeredIds = new Set<number>();
  const out: CreateSubmissionAnswerDTO[] = [];
  const answerEvidence: Record<number, { evidence_source?: string; evidence_quote?: string }> = {};
  // Questions where Claude returned a value the validator could not map
  // to the form's option space (typically RADIO/MULTI_SELECT/SCALE
  // questions whose options don't include yes/no, but the model
  // defaulted to yes/no anyway because the question text reads that
  // way). We GRACEFULLY DEGRADE rather than 502'ing the entire review:
  // the answer is dropped from the persisted set and surfaced as a
  // self-consistency warning so the human reviewer can finish that
  // question manually. This matches the project philosophy of being
  // fluid about form construction; a single mismapped answer should
  // not invalidate hours of cross-source synthesis work.
  const validationFailures: { qid: number; question_text: string; question_type: string; value: string }[] = [];

  for (const a of parsed.answers as any[]) {
    const question = questionsById.get(Number(a.question_id));
    if (!question) continue; // ignore stray answers; AI Feedback question is added by caller
    if (question.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT) continue; // caller fills this
    if (question.question_type === 'TEXT') continue; // human-written commentary fields stay empty for AI runs
    // Defense-in-depth: ROLLUP rows are filtered out of the prompt
    // renderers, but if a model returns one anyway (legacy run, prompt
    // regression, etc.) we drop it on the floor. SubmissionService
    // overwrites it with the engine-derived value before persist
    // either way.
    if (question.role === 'ROLLUP') continue;
    const validated = validateAnswerForQuestion(a.value, question);
    if (validated == null) {
      // YES_NO has a well-defined fixed enum; a mismatch here is a hard
      // contract break and SHOULD throw (the upstream prompt is explicit
      // about the legal values). For author-defined option spaces
      // (RADIO/MULTI_SELECT/SCALE) we degrade gracefully so the human
      // reviewer can finish manually instead of losing the whole review.
      if (question.question_type === 'YES_NO') {
        throw new AIReviewerServiceError(
          `Claude returned an unrecognized value for question_id=${question.id} (${question.question_text}): ${JSON.stringify(a.value)}`,
          'AI_OUTPUT_INVALID',
          502
        );
      }
      const failure = {
        qid: question.id,
        question_text: question.question_text,
        question_type: question.question_type,
        value: String(a.value ?? ''),
      };
      validationFailures.push(failure);
      logger.warn(
        `[AI REVIEWER] question_id=${failure.qid} (${failure.question_type}) value ${JSON.stringify(failure.value)} ` +
        `did not match any configured option for "${failure.question_text}" - skipping AI answer; ` +
        `the human reviewer will complete this question.`
      );
      continue;
    }
    out.push({
      question_id: question.id,
      answer: validated,
      ai_confidence: clampConfidence(a.confidence),
    });
    answeredIds.add(question.id);

    // Phase A: capture per-answer evidence. Evidence is best-effort —
    // missing fields are tolerated (we just store what the model gave us).
    const evSource = typeof a.evidence_source === 'string' ? a.evidence_source.trim() : '';
    const evQuoteRaw = typeof a.evidence_quote === 'string' ? a.evidence_quote.trim() : '';
    // Cap the verbatim quote at 240 chars per the prompt contract — the
    // model occasionally exceeds the cap, and an oversized quote bloats
    // ai_extras for no reviewer benefit.
    const evQuote = evQuoteRaw.length > 240 ? evQuoteRaw.slice(0, 240) + '…' : evQuoteRaw;
    if (evSource || evQuote) {
      answerEvidence[question.id] = {
        ...(evSource ? { evidence_source: evSource } : {}),
        ...(evQuote ? { evidence_quote: evQuote } : {}),
      };
    }
  }

  // Every gradeable question must have an answer. TEXT questions are
  // always human-only (except the auto-managed AI Reviewer Feedback,
  // filled by the caller); INFO_BLOCK is non-gradeable display content.
  const failedQids = new Set(validationFailures.map((f) => f.qid));
  for (const q of form.questions) {
    if (q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT) continue;
    if (q.question_type === 'INFO_BLOCK' || q.question_type === 'TEXT' || q.question_type === 'SUB_CATEGORY') continue;
    // ROLLUP rows are intentionally not in the prompt; a model correctly
    // following the spec will not answer them, so do not throw here.
    if (q.role === 'ROLLUP') continue;
    // Validation-failed questions were intentionally skipped above; they
    // surface as self-consistency warnings instead.
    if (failedQids.has(q.id)) continue;
    if (!answeredIds.has(q.id)) {
      throw new AIReviewerServiceError(
        `Claude did not answer question_id=${q.id} (${q.question_text}).`,
        'AI_OUTPUT_INVALID',
        502
      );
    }
  }

  // Deterministic NA-gate guard. When a parent "summary" question is
  // N/A-allowed AND all of its opportunity gate siblings are answered
  // 'no', the correct verdict per the form's rubric is 'na' (no
  // opportunity arose, so there's nothing to grade). The model often
  // gets this right when the rubric is in the prompt, but occasionally
  // defaults to 'no' anyway — penalizing the agent for an event that
  // never happened. This post-process flips those cases to 'na' as a
  // belt-and-suspenders against model drift. Pure pattern match on
  // question text + category so it works across form versions without
  // needing to thread slug data through FormForPrompt.
  const naGateFlips = applyNaGateGuards(out, form);

  const playbookSteps = parsePlaybookSteps(parsed.playbook_steps);
  const coaching = parseCoachingBlock(parsed.coaching);

  // Phase A self-consistency: when the AI says a "steps followed" question
  // is "no" but doesn't list any missing playbook step, that's a sign the
  // grade and the reasoning artefact disagree. We log it AND surface it as
  // a warning so the orchestrator can trigger a verification pass.
  const selfConsistencyWarnings = detectSelfConsistencyWarnings(out, playbookSteps, form);

  if (naGateFlips.length > 0) {
    selfConsistencyWarnings.push(
      ...naGateFlips.map((f) => `NA-gate guard flipped qid=${f.qid} from 'no' to 'na' (${f.reason})`)
    );
  }

  // Surface AI contract violations on author-defined option spaces
  // (RADIO / MULTI_SELECT / SCALE). These were silently dropped from
  // `out` above instead of 502'ing the whole review; routing them here
  // lets the UI show the reviewer exactly which questions to answer
  // manually. The text is reviewer-facing - it appears in the warnings
  // panel on the submission, so phrase it as actionable guidance, not
  // a stack trace.
  if (validationFailures.length > 0) {
    selfConsistencyWarnings.push(
      ...validationFailures.map(
        (f) =>
          `AI did not return a valid ${f.question_type} value for q${f.qid} ("${f.question_text}") - returned ${JSON.stringify(f.value)}; please answer manually.`
      )
    );
  }

  // Tier-2 (Phase F) evidence-floor enforcement: the synthesis prompt
  // tells the model to prefer "no" when the evidence_quote is empty for
  // a yes verdict, but the model often ignores that rule in practice
  // (it's the single biggest source of overconfident graded-yes answers
  // we saw on closed cases). Move the rule into code so it can't be
  // ignored: any positive verdict (YES on YES_NO, any RADIO/MULTI_SELECT
  // option with a positive score, any SCALE value > 0) MUST be backed by
  // an evidence_quote that is at least 20 chars AND carries a date or
  // transcript-timestamp anchor. Otherwise we cap that answer's
  // ai_confidence at 0.5 and surface a warning so the orchestrator's
  // verification trigger fires the verifier.
  const floorWarnings = enforceEvidenceFloor(out, answerEvidence, form);
  if (floorWarnings.length > 0) {
    selfConsistencyWarnings.push(...floorWarnings);
  }

  if (selfConsistencyWarnings.length > 0) {
    logger.warn(
      `[AI REVIEWER] Self-consistency warnings (${selfConsistencyWarnings.length}): ${selfConsistencyWarnings.join('; ')}`
    );
  }

  return {
    answers: out,
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
    categoryNotes: Array.isArray(parsed.category_notes)
      ? parsed.category_notes
          .filter(
            (n: any) =>
              n &&
              typeof n.category === 'string' &&
              typeof n.notes === 'string' &&
              n.category.trim().length > 0 &&
              n.notes.trim().length > 0
          )
          .map((n: any) => ({ category: String(n.category).trim(), notes: String(n.notes).trim() }))
      : [],
    kbCitations: Array.isArray(parsed.kb_citations)
      ? parsed.kb_citations
          .filter((c: any) => c && Number.isInteger(c.id))
          .map((c: any) => ({ id: Number(c.id), name: String(c.name ?? ''), url: String(c.url ?? '') }))
      : [],
    overallConfidence: clampConfidence(parsed.overall_confidence),
    timeline: parseTimelineArray(parsed.timeline),
    observations: parseObservationsArray(parsed.observations),
    playbookSteps,
    coaching,
    answerEvidence,
    selfConsistencyWarnings,
    cost: null,
  };
}

// Output parsers + post-parse normalization (playbook / coaching /
// self-consistency / evidence-floor / positive-verdict) live in
// ./aiReviewerOutputParsers — imported at the top of this file.

/**
 * Phase A: collapse all AI-side outputs into the ai_extras JSON payload
 * stored on the submission. Returns null when there's nothing worth
 * persisting (preserves the legacy "no extras → null column" behaviour).
 */
function buildAiExtras(parts: {
  timeline: AiTimelineItem[];
  observations: AiObservation[];
  playbookSteps: AiPlaybookStep[];
  coaching: AiCoaching;
  answerEvidence: Record<number, { evidence_source?: string; evidence_quote?: string }>;
  selfConsistencyWarnings: string[];
  verification: AiVerification | null;
  /**
   * Tier-2 Item 4: per-pivot KB hit count for the case. Persisted so
   * the KB Coverage dashboard can aggregate without re-running the
   * pivot detector. Empty / absent when the case ran the legacy
   * (no-pivot) KB grounding path.
   */
  pivots?: PivotKbCoverage[];
}): Record<string, unknown> | null {
  const hasTimeline = parts.timeline.length > 0;
  const hasObservations = parts.observations.length > 0;
  const hasPlaybook = parts.playbookSteps.length > 0;
  const hasCoaching =
    parts.coaching.wins.length + parts.coaching.gaps.length + parts.coaching.next_actions.length > 0;
  const hasEvidence = Object.keys(parts.answerEvidence).length > 0;
  const hasSelfWarnings = parts.selfConsistencyWarnings.length > 0;
  const hasPivots = !!parts.pivots && parts.pivots.length > 0;
  if (
    !hasTimeline &&
    !hasObservations &&
    !hasPlaybook &&
    !hasCoaching &&
    !hasEvidence &&
    !hasSelfWarnings &&
    !parts.verification &&
    !hasPivots
  ) {
    return null;
  }
  return {
    timeline: parts.timeline,
    observations: parts.observations,
    ...(hasPlaybook ? { playbook_steps: parts.playbookSteps } : {}),
    ...(hasCoaching ? { coaching: parts.coaching } : {}),
    ...(hasEvidence ? { answer_evidence: parts.answerEvidence } : {}),
    ...(hasSelfWarnings ? { self_consistency_warnings: parts.selfConsistencyWarnings } : {}),
    ...(parts.verification ? { verification: parts.verification } : {}),
    ...(hasPivots ? { pivots: parts.pivots } : {}),
  };
}

/**
 * Verifier output shape (Tier-1 Item 2).
 *
 * The verifier no longer just returns warnings — it returns asymmetric
 * deltas the orchestrator applies to `overall_confidence` and to each
 * answer's `ai_confidence` before persistence.
 *
 * Asymmetric clamps (the anti-gaming safeguard):
 *   - `overall_delta` is bounded `[-0.20, +0.10]`.
 *   - `per_answer_deltas[qid]` is bounded `[-0.20, +0.05]`.
 *   - Negative range is twice the positive range. The verifier exists
 *     to catch problems, not to validate; even a confused verifier
 *     can't materially inflate confidence.
 */
export interface VerificationResult {
  warnings: string[];
  overall_delta: number;
  per_answer_deltas: Record<number, number>;
}

/** Bound a number to [min, max], coercing NaN/null to 0. */
/**
 * Tier-1 verification pass (Item 2). Runs ONE Claude call asking the
 * model to audit its own previous output against the trace artefacts
 * (timeline + playbook + observations) and emit:
 *   - warnings:   the legacy per-answer flag list
 *   - overall_delta:  signed adjustment to overall_confidence
 *                     (bounded [-0.20, +0.10])
 *   - per_answer_deltas: signed adjustment to ai_confidence per
 *                        question_id (bounded [-0.20, +0.05])
 *
 * Capped at one verifier call per review by the orchestrator. Always
 * wrapped in withCallLog so the extra cost shows up in `ai_call_logs`
 * with `pass: 'verification'`.
 *
 * Throws on hard provider failures; caller catches and proceeds with
 * the original answers (verification is advisory, never fails a run).
 */
async function runVerificationPass(
  ctx: {
    answers: CreateSubmissionAnswerDTO[];
    timeline: AiTimelineItem[];
    playbookSteps: AiPlaybookStep[];
    observations: AiObservation[];
    /**
     * Reviewer-facing per-category commentary. Added to the verifier
     * input so the absence-claim audit (see verifySystem) can catch
     * partial-presence-reported-as-full-absence errors in the
     * category_notes text that the user sees as the per-category
     * "Feedback" paragraph. The user sees this text directly, so a
     * factually wrong "X was omitted" claim here is the most
     * user-visible faithfulness failure mode.
     */
    categoryNotes: { category: string; notes: string }[];
    /**
     * SPIN-style coaching block. Coaching.gaps[] is the third common
     * surface for absence claims (alongside observations[] and
     * categoryNotes[]) — same audit rule applies.
     */
    coaching: AiCoaching;
  },
  traceCtx: CallLogMeta,
  provider: ModelProvider = 'anthropic',
  /**
   * Optional explicit model override. Mirrors the reasoning-pass
   * override so a single Sonnet-vs-Opus compare lane stays on Sonnet
   * end-to-end (no Opus calls fire on the alt lane).
   */
  modelOverride?: string
): Promise<VerificationResult> {
  // The new prompt asks for warnings AND deltas in one shot. We
  // explicitly call out the asymmetric clamp so the model knows it
  // cannot inflate confidence by more than +0.10. Worked examples
  // anchor the magnitude — empirically, models follow shape better
  // when given a few "small/medium/large" calibration points.
  const verifySystem =
    'You are auditing your own previous output as the QA reviewer. Examine the answers, timeline, playbook_steps, observations, category_notes, and coaching below.\n\n' +
    'Two outputs are required:\n' +
    '  1. warnings[]: one short sentence per flagged finding. Empty array is fine when nothing is mismatched. Flag answer-level concerns (yes-verdict with no supporting timeline item, no-verdict with no missing playbook step) AND narrative-level faithfulness concerns (see "Absence-claim audit" below).\n' +
    '  2. confidence_deltas: signed adjustments you would make to the original confidence numbers. Negative numbers REDUCE confidence (use this for unsupported answers); positive numbers INCREASE it (use ONLY when the trace is unambiguously stronger than the original confidence reflected).\n\n' +
    'Bounds (we will clamp anything outside these — emit values within them):\n' +
    '  - overall_delta: [-0.20, +0.10]   (negative half is wider on purpose — the verifier exists to catch problems, not to validate).\n' +
    '  - per_answer_deltas[<question_id>]: [-0.20, +0.05] per question.\n\n' +
    'Magnitude calibration:\n' +
    '  - 0.00  = no change (the original number was right)\n' +
    '  - -0.05 = small concern (one weak supporting quote)\n' +
    '  - -0.10 = moderate concern (verdict and trace partially disagree)\n' +
    '  - -0.20 = strong concern (verdict directly contradicted by the trace)\n' +
    '  - +0.05 = trace fully supports the verdict and the original confidence was unjustifiably low\n' +
    '  - +0.10 = whole-review picture is materially stronger than the per-answer numbers reflected\n\n' +
    'Bias toward catching problems. If you are unsure, lean negative. Do NOT use positive deltas as a "vote of confidence" — they are reserved for cases where the original number understated objective trace support.\n\n' +
    'Absence-claim audit (CRITICAL — narrative-level faithfulness check, applies to observations[], category_notes[], and coaching.gaps[]):\n' +
    '- For every entry in observations[].message, category_notes[].notes, and coaching.gaps[] that contains an absence keyword ("missing", "omitted", "not documented", "not captured", "not recorded", "not in notes", "not on the ticket", "absent", or any equivalent phrasing), verify the finding SHAPE:\n' +
    '  - VALID shape: the finding either (a) quotes a verbatim related snippet that IS present (in single or double quotes, anchored to a note date / transcript timestamp / KB page name) and names which atomic part is missing, OR (b) explicitly states "no related content in <named surfaces>" naming the surfaces searched.\n' +
    '  - INVALID shape: the finding makes a compound absence claim like "X-and-Y was not documented" without quoting the parts of X-and-Y that ARE present, OR uses "omitted from notes" as a vague shorthand without naming what was searched.\n' +
    '- For every INVALID-shape absence claim, emit a warning of the form: "Absence-claim shape: <surface>[<index>] claims \'<short paraphrase of claim>\' without quoting affirmative content or naming searched surfaces — likely partial-presence reported as full absence."\n' +
    '- Penalize the overall_delta by an additional -0.05 per invalid-shape absence claim (up to the existing -0.20 clamp). These are user-visible faithfulness errors and the most common source of human-reviewer confusion.\n' +
    '- A correctly-shaped absence claim (with affirmative quote OR explicit empty-search statement) is FINE — do NOT flag those.\n\n' +
    'Respond with ONLY this JSON object (no prose, no code fences):\n' +
    '{ "warnings": ["<one short sentence per flagged finding>"], "overall_delta": <number>, "per_answer_deltas": { "<question_id>": <number>, ... } }';
  const verifyUser = JSON.stringify(
    {
      answers: ctx.answers.map((a) => ({
        question_id: a.question_id,
        value: a.answer,
        ai_confidence: a.ai_confidence ?? null,
      })),
      timeline: ctx.timeline,
      playbook_steps: ctx.playbookSteps,
      observations: ctx.observations,
      category_notes: ctx.categoryNotes,
      coaching: ctx.coaching,
    },
    null,
    2
  );

  return withCallLog<VerificationResult>(
    { ...traceCtx, provider },
    { system: verifySystem, user: verifyUser },
    async () => {
      const model = resolveModelName(provider, modelOverride);
      const out = await callChatModel(provider, {
        system: verifySystem,
        user: verifyUser,
        model,
        maxTokens: 1500,
        timeoutMs: 300_000,
        responseFormat: 'json_object',
      });
      const tokensIn = out.tokensIn;
      const tokensOut = out.tokensOut;
      const raw = out.text;
      const parsed = tryParseJson(raw);
      const warnings: string[] =
        parsed && Array.isArray(parsed.warnings)
          ? parsed.warnings
              .map((w: unknown) => (typeof w === 'string' ? w.trim() : ''))
              .filter((s: string) => s.length > 0)
          : [];
      const overall_delta = clampDelta(parsed?.overall_delta, -0.2, 0.1);
      const per_answer_deltas: Record<number, number> = {};
      const rawPer = parsed?.per_answer_deltas;
      if (rawPer && typeof rawPer === 'object') {
        for (const [k, v] of Object.entries(rawPer)) {
          const qid = Number(k);
          if (!Number.isInteger(qid)) continue;
          const d = clampDelta(v, -0.2, 0.05);
          if (d !== 0) per_answer_deltas[qid] = d;
        }
      }
      return {
        result: { warnings, overall_delta, per_answer_deltas },
        model,
        rawResponse: raw,
        retried: false,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Apply a verifier `VerificationResult`'s deltas to the answers + the
 * overall confidence in place. Returns the (clamped) new
 * `overallConfidence` so callers can persist the moved value.
 *
 * Mutates `answers[].ai_confidence` so downstream calibration sees the
 * post-verifier numbers. Logs before/after so we can audit whether the
 * verifier is actually moving the confidence.
 */
function applyVerificationDeltas(
  answers: CreateSubmissionAnswerDTO[],
  overallConfidence: number | null,
  result: VerificationResult,
  caseLabel: string
): number | null {
  let newOverall = overallConfidence;
  if (overallConfidence != null && result.overall_delta !== 0) {
    newOverall = clampConfidence(overallConfidence + result.overall_delta);
    logger.info(
      `[AI REVIEWER] verification overall delta (${caseLabel}) ${overallConfidence.toFixed(2)} -> ${(newOverall ?? 0).toFixed(2)} (delta=${result.overall_delta.toFixed(2)})`
    );
  }
  for (const a of answers) {
    const d = result.per_answer_deltas[a.question_id] ?? 0;
    if (d === 0) continue;
    const before = a.ai_confidence ?? 0;
    a.ai_confidence = clampConfidence(before + d);
    logger.info(
      `[AI REVIEWER] verification per-answer delta (${caseLabel}, q=${a.question_id}) ${before.toFixed(2)} -> ${(a.ai_confidence ?? 0).toFixed(2)} (delta=${d.toFixed(2)})`
    );
  }
  return newOverall;
}

// Answer validation + NA-gate guards live in ./aiReviewerAnswerValidation —
// imported at the top of this file.

// Reviewer-facing feedback composition (category-notes routing + bottom
// AI Reviewer Feedback HTML) lives in ./aiReviewerFeedback — imported at the
// top of this file.

export const aiReviewerService = new AIReviewerService();
export default aiReviewerService;

/**
 * @internal Test-only exports. The Phase A self-consistency rule is a
 * private parse-time check that downgrades the AI's confidence when its
 * answers contradict its own playbook trace. Exposed here so the unit
 * test can exercise the rule without spinning up Claude or the DB.
 */
export const _internal = {
  mapClaudeOutputToAnswers,
  parsePlaybookSteps,
  parseCoachingBlock,
  detectSelfConsistencyWarnings,
  enforceEvidenceFloor,
  mergeSubmissionLinks,
  applyNaGateGuards,
  filterPostAuditNotes,
  resolvePostCallDocWindowMs,
  renderAuditScopeLine,
  parseDraftAnswers,
  extractNarrative,
  runReconciliationPass,
  composeCategoryFeedback,
  composeBottomFeedback,
};

