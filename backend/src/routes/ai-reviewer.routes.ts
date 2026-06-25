/**
 * AI Reviewer routes — manual triggers for the synthetic AI Reviewer user
 * to fill out and submit a real qtip audit against a closed CRM ticket
 * (and, in the future, a closed CRM task or a call).
 *
 * Auth required (any authenticated user; the AI Reviewer user that the
 * submission is attributed to comes from `AI_REVIEWER_USER_ID`, NOT from
 * the caller). Per-form opt-in is enforced inside the service via the
 * `forms.ai_enabled` flag; this route layer just routes + validates input.
 */

import express, { Request, Response } from 'express';
import { authenticate, authorizeAdmin, authorizePage } from '../middleware/auth';
import aiReviewerService, {
  AIReviewerServiceError,
  loadCase,
  type CaseSourceRef,
} from '../services/AIReviewerService';
import { SubmissionService, SubmissionServiceError } from '../services/SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import aiCalibrationService from '../services/AICalibrationService';
import rulePackService, { RulePackError } from '../services/RulePackService';
import basePromptService, { BasePromptError, type PromptKind } from '../services/BasePromptService';
import { normalizeGuidance } from '../repositories/MySQLFormRepository';
import {
  previewSystemPrompt,
  listQuestionRubricsForForm,
  upsertQuestionRubric,
  deleteQuestionRubric,
} from '../services/aiReviewerPrompt';
import aiGoldenSetService, { AIGoldenSetServiceError } from '../services/AIGoldenSetService';
import { runGoldenEval, getLatestEvalRun } from '../services/AIGoldenEvalRunner';
import {
  fitAndStore as fitCalibrationMap,
  activateMap as activateCalibrationMap,
  getCalibrationCoverage,
  previewFit as previewCalibrationFit,
} from '../services/ConfidenceCalibratorFitter';
import { getActiveMapForForm } from '../services/ConfidenceCalibrator';
import { aggregateKbCoverage } from '../services/KbCoverageAggregator';
import { getDriftStatusForForm } from '../services/AIDriftDetector';
import { getCostStatusForForm } from '../services/AIReviewerCostGuard';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = express.Router();
router.use(authenticate);
// Every AI Reviewer endpoint requires the `quality_ai_reviewer` page grant.
// Per-endpoint `authorizeAdmin` calls below stay as a stricter overlay for
// admin-only operations (rubric edits, prompt management, etc.).
// `quality_ai_inbox` is a separate page key — the /inbox endpoint below also
// requires it; the AI Inbox page in the UI is gated to that key.
router.use(authorizePage('quality_ai_reviewer', 'viewAll'));

/**
 * Hard cap on the per-form `ai_review_guidance` free-text addendum, in chars.
 * The guidance field is the lowest-friction place for prompt growth to sneak
 * in (a QA admin can paste an entire wiki page into it). 2000 chars (~500
 * tokens) is plenty for a paragraph of form-specific guidance; anything
 * longer should live in a versioned rule pack instead, where it's reviewable
 * in git and counted against the rule-pack budget.
 */
const AI_REVIEW_GUIDANCE_MAX_CHARS = 2000;

function parsePositiveInt(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Validate the optional `attached_sources[]` body field for `POST /run`.
 *
 * Returns either `{ refs }` (a normalized list of `CaseSourceRef`) or
 * `{ error }` (the human-readable message the route returns as a 400).
 *
 * Each entry is `{ kind: 'TICKET'|'TASK'|'CONVERSATION', external_id }`.
 * - TICKET / TASK → coerced to `{ kind, external_id: number }`.
 * - CONVERSATION  → coerced to `{ kind: 'CALL', external_id: string }`
 *   (the route layer's user-facing label is CONVERSATION; the service
 *   layer's adapter contract is CALL — the kind is renamed here so the
 *   rest of the dispatch path doesn't need to know about both).
 *
 * Exported so the route's input contract has unit-test coverage without
 * spinning up Express. Pure function — no I/O.
 */
export function parseAttachedSources(
  raw: unknown
): { refs: CaseSourceRef[] } | { error: string } {
  if (raw === undefined || raw === null) return { refs: [] };
  if (!Array.isArray(raw)) {
    return { error: "Body field 'attached_sources' must be an array when provided." };
  }
  const refs: CaseSourceRef[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object') {
      return { error: `attached_sources[${i}] must be an object { kind, external_id }.` };
    }
    const aKindRaw = (entry as { kind?: unknown }).kind;
    if (aKindRaw !== 'TICKET' && aKindRaw !== 'TASK' && aKindRaw !== 'CONVERSATION') {
      return { error: `attached_sources[${i}].kind must be one of: TICKET, TASK, CONVERSATION.` };
    }
    const aId = (entry as { external_id?: unknown }).external_id;
    if (aId == null || (typeof aId !== 'string' && typeof aId !== 'number')) {
      return { error: `attached_sources[${i}].external_id is required (string or number).` };
    }
    const aIdStr = String(aId).trim();
    if (!aIdStr) {
      return { error: `attached_sources[${i}].external_id must not be empty.` };
    }
    if (aKindRaw === 'CONVERSATION') {
      refs.push({ kind: 'CALL', external_id: aIdStr });
    } else {
      const numId = Number(aIdStr);
      if (!Number.isInteger(numId) || numId <= 0) {
        return {
          error: `attached_sources[${i}].external_id must be a positive integer for ${aKindRaw}.`,
        };
      }
      refs.push({ kind: aKindRaw, external_id: numId });
    }
  }
  return { refs };
}

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    configured: aiReviewerService.isConfigured(),
  });
});

/**
 * Deterministic 0-99 hash of a submission id, used for stable sampling
 * decisions in the AI inbox so the same submission either always shows
 * up or never shows up across page loads.
 *
 * djb2 → 32-bit unsigned, modulo 100. Cheap and good enough; calibration
 * cares about being deterministic across loads, not cryptographically
 * uniform.
 */
function deterministicSampleBucket(submissionId: number): number {
  let h = 5381;
  const s = String(submissionId);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/**
 * Phase C (C4): collapse multiple submissions belonging to the same
 * `case_id` (multi-source review of one ticket+call pair) into a single
 * inbox row. The freshest submission wins on submitted_at. Submissions
 * with no case_id (legacy or null payload) pass through one-per-row.
 *
 * The optional `seen` set lets callers share state across calls so the
 * same case isn't materialized into more than one of {drafts, samples}
 * sections of the response.
 */
function dedupByCaseId<T extends { id: number; case_id: string | null; submitted_at: Date | null }>(
  rows: T[],
  seen?: Set<string>
): T[] {
  const localSeen = seen ?? new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (!r.case_id) {
      out.push(r);
      continue;
    }
    if (localSeen.has(r.case_id)) continue;
    localSeen.add(r.case_id);
    out.push(r);
  }
  return out;
}

/**
 * Phase C (C4): turn a `<KIND>:<external_id>` case_id into the short
 * label the inbox UI shows ("Ticket #123", "Call abc-…", "Task #45").
 * Falls back to ticket external id for legacy rows that pre-date C4.
 */
function caseIdToSourceLabel(caseId: string | null, ticketExternalId: bigint | undefined): string {
  if (caseId) {
    const idx = caseId.indexOf(':');
    if (idx > 0) {
      const kind = caseId.slice(0, idx);
      const id = caseId.slice(idx + 1);
      if (kind === 'TICKET') return `Ticket #${id}`;
      if (kind === 'TASK') return `Task #${id}`;
      if (kind === 'CALL') return `Call ${id}`;
    }
  }
  if (ticketExternalId != null) return `Ticket #${ticketExternalId.toString()}`;
  return '—';
}

/**
 * GET /api/ai-reviewer/inbox
 *
 * Returns two arrays for the QA AI Review Inbox:
 *
 *   - drafts_awaiting_promotion — every DRAFT submission belonging to
 *     the AI Reviewer user (forms in Calibrating mode produce these).
 *   - samples_awaiting_review   — Trusted-mode AI submissions (status =
 *     SUBMITTED, form.ai_submit_as_draft = false) that landed in the
 *     deterministic sample window (low-score-always or hash bucket
 *     under the form's ai_sample_review_pct) and don't yet have a
 *     calibration row tagged 'qa_sample_review'.
 *
 * Each item carries the minimum the inbox UI needs to render a row.
 */
router.get('/inbox', async (_req: Request, res: Response) => {
  if (!aiReviewerService.isConfigured()) {
    return res.status(503).json({ error: 'AI Reviewer is not configured.', code: 'NOT_CONFIGURED' });
  }
  const aiUserId = (await import('../config/environment')).aiReviewerConfig?.userId;
  if (!aiUserId) {
    return res.status(503).json({ error: 'AI Reviewer user id missing.', code: 'NOT_CONFIGURED' });
  }

  try {
    // ── Drafts (Calibrating mode) ────────────────────────────────────────
    const drafts = await prisma.submission.findMany({
      where: { submitted_by: aiUserId, status: 'DRAFT' },
      include: {
        form: { select: { id: true, form_name: true, critical_cap_percent: true } },
        submission_ticket_tasks: { where: { kind: 'TICKET' }, select: { external_id: true } },
      },
      orderBy: { submitted_at: 'desc' },
      take: 200,
    });

    // Phase C (C4): de-duplicate inbox rows by case_id so multi-source
    // reviews (ticket + linked call) collapse into a single row instead
    // of one per side. Submissions without a case_id (legacy / null
    // payload) keep one row per submission keyed on submission_id.
    const draftItems = dedupByCaseId(drafts).map((d) => ({
      submission_id: d.id,
      form_id: d.form_id,
      form_name: d.form?.form_name ?? `Form ${d.form_id}`,
      case_id: d.case_id ?? null,
      ticket_id: d.submission_ticket_tasks[0] ? Number(d.submission_ticket_tasks[0].external_id) : null,
      source_label: caseIdToSourceLabel(d.case_id, d.submission_ticket_tasks[0]?.external_id),
      created_at: d.submitted_at,
      total_score: null as number | null,
    }));

    // ── Trusted-mode samples ─────────────────────────────────────────────
    const submitted = await prisma.submission.findMany({
      where: {
        submitted_by: aiUserId,
        status: 'SUBMITTED',
        form: { ai_enabled: true, ai_submit_as_draft: false },
      },
      include: {
        form: {
          select: {
            id: true,
            form_name: true,
            critical_cap_percent: true,
            ai_sample_review_pct: true,
            ai_sample_low_score_always: true,
            ai_sample_low_confidence_threshold: true,
            ai_disagreement_route_threshold: true,
          },
        },
        submission_ticket_tasks: { where: { kind: 'TICKET' }, select: { external_id: true } },
        submission_answers: { select: { question_id: true } },
      },
      orderBy: { submitted_at: 'desc' },
      take: 500,
    });

    // Per-form rolling per-question kappa cache for Phase 6 routing. We
    // load lazily inside the loop and memoize per form_id so we hit
    // AICalibrationService at most once per distinct form on this query.
    const perQuestionByForm = new Map<number, Map<number, { kappa: number | null; n: number }>>();

    const alreadyReviewed = await prisma.aiCalibrationData.findMany({
      where: {
        source: 'qa_sample_review',
        ai_submission_id: { in: submitted.map((s) => s.id) },
      },
      select: { ai_submission_id: true },
    });
    const reviewedSet = new Set(alreadyReviewed.map((r) => r.ai_submission_id));

    const sampleItems: Array<{
      submission_id: number;
      form_id: number;
      form_name: string;
      case_id: string | null;
      ticket_id: number | null;
      source_label: string;
      created_at: Date | null;
      total_score: number | null;
      ai_overall_confidence: number | null;
      routing_reason: 'low_score' | 'low_confidence' | 'low_question_agreement' | 'random_sample';
    }> = [];
    // ROUTING SOURCE OF TRUTH for the AI inbox. The synchronous helper
    // AICalibrationService.shouldRouteToReviewInbox() implements ONLY the
    // score-based fast path that runs during submission persistence.
    // Confidence-based and disagreement-based routing live HERE because
    // they need per-form thresholds and rolling-agreement cache lookups
    // that are not worth plumbing through the write path. If you add a
    // new routing reason, default it to this materializer first; promote
    // it into the helper only if it must run synchronously on every save.
    //
    // Confidence comparison uses CALIBRATED confidence when available
    // (Phase 4 — empirical confidence calibration). Falls back to nominal
    // when no active calibration map exists for the form, which is the
    // identity case (calibrated === nominal) anyway.
    // Same case-id collapse as drafts above so a single review covers
    // every submission in the case.
    const seenCases = new Set<string>();
    for (const s of dedupByCaseId(submitted, seenCases)) {
      if (reviewedSet.has(s.id)) continue;
      const cap = s.form?.critical_cap_percent != null ? Number(s.form.critical_cap_percent) : null;
      const score = s.total_score != null ? Number(s.total_score) : null;
      const calibratedConf = (s as any).ai_calibrated_confidence != null
        ? Number((s as any).ai_calibrated_confidence)
        : null;
      const nominalConf = s.ai_overall_confidence != null ? Number(s.ai_overall_confidence) : null;
      const overallConf = calibratedConf ?? nominalConf;
      const lowConfThreshold =
        s.form?.ai_sample_low_confidence_threshold != null
          ? Number(s.form.ai_sample_low_confidence_threshold)
          : null;
      const lowScoreAlways = s.form?.ai_sample_low_score_always === true;
      const pct = Math.max(0, Math.min(100, Number(s.form?.ai_sample_review_pct ?? 0)));

      const isLowScore = lowScoreAlways && cap != null && score != null && score < cap;
      // Low-confidence routing: when the form has a threshold AND the AI
      // reported a confidence value below it. Drives "the AI itself wasn't
      // sure → a human should look" without the operator having to crank
      // up the random sample percentage.
      const isLowConfidence =
        lowConfThreshold != null && overallConf != null && overallConf < lowConfThreshold;
      const inSampleBucket = pct > 0 && deterministicSampleBucket(s.id) < pct;

      // Disagreement-driven routing (Phase 6): if any question this
      // submission answered has a rolling kappa below the form's
      // ai_disagreement_route_threshold, route. This catches "the model
      // was confident AND the score was fine, but historically it's
      // wrong on this specific question" — the failure mode confidence
      // alone misses.
      const disagreementThreshold =
        s.form?.ai_disagreement_route_threshold != null
          ? Number(s.form.ai_disagreement_route_threshold)
          : null;
      let isLowQuestionAgreement = false;
      if (disagreementThreshold != null && s.form?.id != null && s.submission_answers.length > 0) {
        let perQ = perQuestionByForm.get(s.form.id);
        if (!perQ) {
          perQ = await aiCalibrationService.getRollingPerQuestionAgreement(s.form.id);
          perQuestionByForm.set(s.form.id, perQ);
        }
        for (const ans of s.submission_answers) {
          const stat = perQ.get(ans.question_id);
          if (stat?.kappa != null && stat.kappa < disagreementThreshold) {
            isLowQuestionAgreement = true;
            break;
          }
        }
      }

      if (!isLowScore && !isLowConfidence && !isLowQuestionAgreement && !inSampleBucket) continue;

      sampleItems.push({
        submission_id: s.id,
        form_id: s.form_id,
        form_name: s.form?.form_name ?? `Form ${s.form_id}`,
        case_id: s.case_id ?? null,
        ticket_id: s.submission_ticket_tasks[0] ? Number(s.submission_ticket_tasks[0].external_id) : null,
        source_label: caseIdToSourceLabel(s.case_id, s.submission_ticket_tasks[0]?.external_id),
        created_at: s.submitted_at,
        total_score: score,
        ai_overall_confidence: overallConf,
        routing_reason: isLowScore
          ? 'low_score'
          : isLowConfidence
            ? 'low_confidence'
            : isLowQuestionAgreement
              ? 'low_question_agreement'
              : 'random_sample',
      });
    }

    return res.json({
      drafts_awaiting_promotion: draftItems,
      samples_awaiting_review: sampleItems,
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] inbox unexpected failure', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to load AI inbox' });
  }
});

/**
 * POST /api/ai-reviewer/ticket/:id
 * Body: { formId: number }
 *
 * Loads the named form (must have ai_enabled=true), pulls the ticket +
 * notes from the CRM, runs heuristics + KB search, calls Claude, and
 * submits the resulting answers via the standard submitAudit pipeline.
 */
router.post('/ticket/:id', async (req: Request, res: Response) => {
  const ticketId = parsePositiveInt(req.params.id);
  if (ticketId === null) {
    return res.status(400).json({ error: 'Invalid ticket id; must be a positive integer.' });
  }
  const formId = parsePositiveInt(req.body?.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'Body must include { formId: <positive integer> }.' });
  }

  try {
    const result = await aiReviewerService.reviewClosedTicket(ticketId, { formId });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof AIReviewerServiceError) {
      logger.warn(`[AI REVIEWER ROUTE] ${err.code}: ${err.message}`);
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] unexpected failure', { error: (err as Error).message, stack: (err as Error).stack });
    return res.status(500).json({ error: 'Failed to run AI review' });
  }
});

const submissionService = new SubmissionService(new MySQLSubmissionRepository());

/**
 * POST /api/ai-reviewer/run
 * Body: { form_id: number, kind: 'TICKET' | 'TASK' | 'CONVERSATION', external_id: string | number }
 *
 * Unified manual-run dispatcher used by the "Run AI manually" card on
 * the AI Reviewer per-form management page. Validates the form is
 * AI-enabled and that the requested `kind` is compatible with the
 * form's `interaction_type`, then forwards to the matching service
 * method. Returns the standard AIReviewResult shape so the caller can
 * deep-link to the resulting submission (DRAFT in Calibrating mode,
 * SUBMITTED in Trusted mode).
 */
router.post('/run', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.body?.form_id);
  if (formId === null) {
    return res.status(400).json({ error: 'Body must include { form_id: <positive integer> }.' });
  }

  // Optional per-call provider override. Lets the compare-models UI
  // fire two parallel runs (one Anthropic, one OpenAI) without
  // mutating the form's persisted `ai_model_provider`. When omitted,
  // the service falls back to the form column (defaults 'anthropic').
  const rawProviderOverride = req.body?.provider;
  let providerOverride: 'anthropic' | 'openai' | undefined;
  if (rawProviderOverride != null) {
    if (rawProviderOverride !== 'anthropic' && rawProviderOverride !== 'openai') {
      return res
        .status(400)
        .json({ error: "Body field 'provider' must be one of: anthropic, openai." });
    }
    providerOverride = rawProviderOverride;
  }

  // Optional per-call MODEL-TIER override. Drives the "Compare Sonnet
  // vs Opus" button on the Manual Run card: both lanes are Anthropic,
  // one runs DEFAULT (Opus), the other runs ALT (Sonnet). When omitted
  // or 'default', behaviour is unchanged. 'alt' resolves to
  // ANTHROPIC_ALT_MODEL — kept Anthropic-only for now because OpenAI
  // doesn't yet have an analogous in-family alternate worth exposing
  // through this button.
  const rawModelTier = req.body?.model_tier;
  let reasoningModelOverride: string | undefined;
  if (rawModelTier != null) {
    if (rawModelTier !== 'default' && rawModelTier !== 'alt') {
      return res
        .status(400)
        .json({ error: "Body field 'model_tier' must be one of: default, alt." });
    }
    if (rawModelTier === 'alt') {
      if (providerOverride === 'openai') {
        return res.status(400).json({
          error:
            "model_tier='alt' is only supported when provider is 'anthropic'. " +
            'Use the Claude vs ChatGPT compare for cross-provider runs.',
          code: 'MODEL_TIER_PROVIDER_UNSUPPORTED',
        });
      }
      const alt = process.env.ANTHROPIC_ALT_MODEL?.trim();
      if (!alt) {
        return res.status(400).json({
          error:
            "model_tier='alt' requires ANTHROPIC_ALT_MODEL to be set in the backend env.",
          code: 'ANTHROPIC_ALT_MODEL_NOT_CONFIGURED',
        });
      }
      reasoningModelOverride = alt;
    }
  }

  const rawKind = req.body?.kind;
  const kind: 'TICKET' | 'TASK' | 'CONVERSATION' | null =
    rawKind === 'TICKET' || rawKind === 'TASK' || rawKind === 'CONVERSATION' ? rawKind : null;
  if (!kind) {
    return res.status(400).json({ error: "Body field 'kind' must be one of: TICKET, TASK, CONVERSATION." });
  }

  const rawExternalId = req.body?.external_id;
  if (rawExternalId == null || (typeof rawExternalId !== 'string' && typeof rawExternalId !== 'number')) {
    return res.status(400).json({ error: "Body field 'external_id' is required (string or number)." });
  }
  const externalIdStr = String(rawExternalId).trim();
  if (!externalIdStr) {
    return res.status(400).json({ error: "Body field 'external_id' must not be empty." });
  }

  // Phase C (C6): optional `attached_sources[]` lets a manual run grade
  // a multi-source case. See `parseAttachedSources` below.
  const parsedAttached = parseAttachedSources(req.body?.attached_sources);
  if ('error' in parsedAttached) {
    return res.status(400).json({ error: parsedAttached.error });
  }
  const attachedRefs = parsedAttached.refs;

  try {
    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: {
        id: true,
        form_name: true,
        ai_enabled: true,
        ai_max_attached_sources: true,
      },
    });
    if (!form) {
      return res.status(404).json({ error: `Form ${formId} not found.` });
    }
    if (!form.ai_enabled) {
      return res.status(403).json({
        error: `Form "${form.form_name}" is not AI-enabled. Enable it in the form builder first.`,
        code: 'FORM_NOT_AI_ELIGIBLE',
      });
    }

    // NOTE: We intentionally do NOT consult form.interaction_type here.
    // Per product direction, `interaction_type` on a form is informational
    // metadata only — the actual review path is dictated by what's
    // attached to the run (ticket / task / conversation). A form can be
    // used for any source kind without "matching" its tag.

    // Cap enforcement: `ai_max_attached_sources` is the form-level cap on
    // *attached* refs (the primary doesn't count). The service-layer
    // `loadCase` also caps via its own default, but we surface the form's
    // limit here as a 400 so the UI can show a clear error before we
    // burn a Claude call on a doomed run.
    if (attachedRefs.length > 0) {
      const cap = Math.max(0, Math.min(10, Number(form.ai_max_attached_sources ?? 3)));
      if (attachedRefs.length > cap) {
        return res.status(400).json({
          error: `Too many attached sources (${attachedRefs.length}); this form caps attachments at ${cap}.`,
          code: 'TOO_MANY_ATTACHED_SOURCES',
        });
      }
    }

    // Capture wall-clock latency on every manual run so the compare-models
    // UI can render "Claude 92s vs ChatGPT 64s" without re-querying the
    // ai_call_logs aggregator. Includes load + trace + synthesis +
    // verification + persistence — i.e. what the user actually waits for.
    const runStartedAt = Date.now();

    let result;
    if (attachedRefs.length === 0) {
      // Single-source path: keep the legacy dispatch (one Claude call).
      // The single-source path is Anthropic-only today (callClaude is
      // hard-coded); the provider override only affects multi-source
      // chunked synthesis. Reject loudly so the compare UI never
      // silently returns identical results on a single-source run.
      if (providerOverride === 'openai') {
        return res.status(400).json({
          error:
            "Provider override 'openai' is only supported for multi-source cases (attached_sources must be present). " +
            'The single-source synthesis path is currently Anthropic-only.',
          code: 'PROVIDER_UNSUPPORTED_SINGLE_SOURCE',
        });
      }
      // Same constraint applies to model_tier='alt' — it's only threaded
      // through the multi-source chunked-synthesis path (reviewCase),
      // not the single-source callClaude path. Fail loudly so the
      // compare UI never silently returns identical Opus results when
      // the user asked for Sonnet.
      if (reasoningModelOverride) {
        return res.status(400).json({
          error:
            "model_tier='alt' is only supported for multi-source cases (attached_sources must be present).",
          code: 'MODEL_TIER_UNSUPPORTED_SINGLE_SOURCE',
        });
      }
      if (kind === 'TICKET' || kind === 'TASK') {
        const numericId = Number(externalIdStr);
        if (!Number.isInteger(numericId) || numericId <= 0) {
          return res.status(400).json({ error: `${kind} external_id must be a positive integer.` });
        }
        result =
          kind === 'TICKET'
            ? await aiReviewerService.reviewClosedTicket(numericId, { formId })
            : await aiReviewerService.reviewClosedTask(numericId, { formId });
      } else {
        result = await aiReviewerService.reviewClosedConversation(externalIdStr, { formId });
      }
    } else {
      // Multi-source path: build a Case (primary + caller-supplied
      // attachments) and dispatch to reviewCase. CALL maps to the
      // service-layer `kind: 'CALL'`; the inbound `kind` value is the
      // route-layer label only.
      let primary: CaseSourceRef;
      if (kind === 'CONVERSATION') {
        primary = { kind: 'CALL', external_id: externalIdStr };
      } else {
        const numericId = Number(externalIdStr);
        if (!Number.isInteger(numericId) || numericId <= 0) {
          return res.status(400).json({ error: `${kind} external_id must be a positive integer.` });
        }
        primary = { kind, external_id: numericId };
      }
      const c = await loadCase(primary, {
        explicitAttached: attachedRefs,
        maxAttachedSources: Math.max(0, Math.min(10, Number(form.ai_max_attached_sources ?? 3))),
      });
      result = await aiReviewerService.reviewCase(c, {
        formId,
        provider: providerOverride,
        reasoningModelOverride,
      });
    }

    const elapsedMs = Date.now() - runStartedAt;
    // Resolved provider: explicit override > form column > 'anthropic'
    // default. Surface in the response so the compare UI knows which
    // side a given submission belongs to without re-querying the form.
    const formRow = await prisma.form.findUnique({
      where: { id: formId },
      select: { ai_model_provider: true },
    });
    const resolvedProvider =
      providerOverride ?? (formRow?.ai_model_provider === 'openai' ? 'openai' : 'anthropic');
    // Resolved reasoning model: surfaced only when the caller explicitly
    // overrode it (the Sonnet-vs-Opus compare button). Lets the UI label
    // each compare card by actual model name without re-querying logs.
    // Omitted on default runs so the response shape stays clean.
    const resolvedReasoningModel = reasoningModelOverride ?? null;

    logger.info(
      `[AI REVIEWER ROUTE] manual run by user ${req.user?.user_id ?? 'unknown'}: ` +
        `form_id=${formId} kind=${kind} external_id=${externalIdStr} attached=${attachedRefs.length} ` +
        `provider=${resolvedProvider}${resolvedReasoningModel ? ` reasoning_model=${resolvedReasoningModel}` : ''} elapsed_ms=${elapsedMs} → submission_id=${result.submission_id} status=${result.status}`
    );
    return res.status(201).json({
      ...result,
      provider: resolvedProvider,
      elapsed_ms: elapsedMs,
      ...(resolvedReasoningModel ? { resolved_reasoning_model: resolvedReasoningModel } : {}),
    });
  } catch (err) {
    if (err instanceof AIReviewerServiceError) {
      logger.warn(`[AI REVIEWER ROUTE] /run ${err.code}: ${err.message}`);
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] /run unexpected failure', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    return res.status(500).json({ error: 'Failed to run AI review' });
  }
});

/**
 * GET /api/ai-reviewer/draft/:submissionId
 *
 * Fetches an AI Reviewer DRAFT submission so the QA reviewer's
 * AuditFormPage can prefill the form with the AI's answers before
 * letting the human edit and promote. Strictly limited to drafts
 * owned by the AI Reviewer user — by design we do not expose other
 * users' drafts here.
 */
router.get('/draft/:submissionId', async (req: Request, res: Response) => {
  const submissionId = parsePositiveInt(req.params.submissionId);
  if (submissionId === null) {
    return res.status(400).json({ error: 'Invalid submission id; must be a positive integer.' });
  }
  const aiUserId = (await import('../config/environment')).aiReviewerConfig?.userId;
  if (!aiUserId) {
    return res.status(503).json({ error: 'AI Reviewer is not configured.', code: 'NOT_CONFIGURED' });
  }

  try {
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        form: { select: { id: true, form_name: true, ai_submit_as_draft: true } },
        submission_answers: true,
        submission_metadata: true,
        submission_ticket_tasks: true,
        // Phase C (multi-source review): attached calls live on
        // submission_calls. We MUST hydrate them on draft fetch so the
        // promote-draft audit page can re-render the same set the AI saw
        // (otherwise the UI shows only the attached ticket and silently
        // drops the call — exactly the bug the user hit).
        submission_calls: { include: { call: true } },
      },
    });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    if (submission.submitted_by !== aiUserId) {
      return res.status(403).json({ error: 'This endpoint only exposes AI Reviewer drafts.' });
    }
    if (submission.status !== 'DRAFT') {
      return res.status(409).json({
        error: `Submission ${submissionId} is ${submission.status}, not DRAFT.`,
        code: 'NOT_A_DRAFT',
      });
    }

    return res.json({
      submission_id: submission.id,
      form_id: submission.form_id,
      form_name: submission.form?.form_name ?? null,
      submitted_at: submission.submitted_at,
      ai_overall_confidence:
        submission.ai_overall_confidence == null ? null : Number(submission.ai_overall_confidence),
      ai_extras: submission.ai_extras ?? null,
      answers: submission.submission_answers.map((a) => ({
        question_id: a.question_id,
        answer: a.answer ?? '',
        notes: a.notes ?? '',
        ai_confidence: a.ai_confidence == null ? null : Number(a.ai_confidence),
      })),
      metadata: submission.submission_metadata.map((m) => ({
        field_id: m.field_id,
        value: m.value ?? '',
      })),
      ticket_tasks: submission.submission_ticket_tasks.map((t) => ({
        kind: t.kind,
        external_id: Number(t.external_id),
      })),
      // Mirrors the Call shape the audit page already uses
      // (frontend/src/services/callService.ts → interface Call).
      calls: submission.submission_calls
        .map((sc) => sc.call)
        .filter((c): c is NonNullable<typeof c> => c != null)
        .map((c) => ({
          id: c.id,
          call_id: c.call_id,
          csr_id: c.csr_id,
          customer_id: c.customer_id ?? null,
          call_date: c.call_date instanceof Date ? c.call_date.toISOString() : String(c.call_date),
          duration: c.duration,
          recording_url: c.recording_url ?? null,
          transcript: c.transcript ?? null,
        })),
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] draft fetch failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to fetch draft' });
  }
});

/**
 * POST /api/ai-reviewer/promote-draft/:submissionId
 * Body: { answers: [{ question_id, answer, notes? }], metadata?: [{ field_id, value }] }
 *
 * Calibrating-mode endpoint. Caller (a human reviewer in the QA inbox)
 * has just edited an AI Reviewer DRAFT submission and is committing
 * those edits as the final SUBMITTED record. We:
 *   1. Promote the draft to SUBMITTED via SubmissionService (re-attributes
 *      it to the calling human and runs scoring).
 *   2. Record a calibration data point (source='qa_promoted_draft')
 *      capturing the diff between the AI's original answers and the
 *      human's final answers.
 */
router.post('/promote-draft/:submissionId', async (req: Request, res: Response) => {
  const submissionId = parsePositiveInt(req.params.submissionId);
  if (submissionId === null) {
    return res.status(400).json({ error: 'Invalid submission id; must be a positive integer.' });
  }
  const userId = req.user?.user_id;
  if (!userId) {
    return res.status(401).json({ error: 'Authenticated user required.' });
  }

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
  if (!answers || answers.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty answers[] array.' });
  }
  const metadata = Array.isArray(req.body?.metadata) ? req.body.metadata : undefined;
  const correctionReason = typeof req.body?.correction_reason === 'string' ? req.body.correction_reason : null;

  try {
    const result = await submissionService.promoteDraftToSubmitted(
      submissionId,
      { answers, metadata },
      userId
    );

    // Phase B (B4): a promoted submission can be tied to a ticket, a call,
    // or both. We pick whichever external id is present (preferring ticket
    // when both exist for combined ticket+call reviews — the ticket is the
    // anchor of record per the user requirement) and tag the calibration
    // row with the correct source_kind. Only when neither side has any
    // external id do we skip — that genuinely means "nothing to learn
    // against" and is logged so QA can investigate.
    let calibrationExternalId: number | null = null;
    let calibrationSourceKind: 'TICKET' | 'CALL' = 'TICKET';
    if (result.ticket_ids.length > 0) {
      calibrationExternalId = result.ticket_ids[0];
      calibrationSourceKind = 'TICKET';
    } else if (result.call_ids.length > 0) {
      calibrationExternalId = result.call_ids[0];
      calibrationSourceKind = 'CALL';
    }
    if (calibrationExternalId != null) {
      try {
        await aiCalibrationService.recordPromotedDraft({
          formId: result.form_id,
          ticketId: calibrationExternalId,
          sourceKind: calibrationSourceKind,
          submissionId: result.submission_id,
          aiAnswers: result.ai_answers_snapshot,
          humanAnswers: result.human_answers,
          gradedBy: userId,
          correctionReason,
        });
      } catch (calErr) {
        // Calibration is best-effort — promotion already succeeded and
        // is the system of record. Log loudly and let the caller know.
        logger.warn(`[AI REVIEWER ROUTE] Promotion succeeded but calibration record failed: ${(calErr as Error).message}`);
      }
    } else {
      logger.warn(`[AI REVIEWER ROUTE] Promoted submission ${submissionId} has no linked ticket OR call; skipping calibration record.`);
    }

    return res.status(200).json({
      submission_id: result.submission_id,
      total_score: result.total_score,
      message: result.message,
    });
  } catch (err) {
    if (err instanceof SubmissionServiceError) {
      logger.warn(`[AI REVIEWER ROUTE] promote-draft ${err.code}: ${err.message}`);
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] promote-draft unexpected failure', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    return res.status(500).json({ error: 'Failed to promote draft' });
  }
});

/**
 * POST /api/ai-reviewer/calibration-overlay/:submissionId
 * Body: { answers: [{ question_id, answer, notes? }], metadata?: [{ field_id, value }] }
 *
 * Trusted-mode endpoint. The :submissionId is an existing SUBMITTED AI
 * submission that was sampled into the QA inbox. The caller's answers
 * are the human's re-grade. We:
 *   1. Create a NEW human submission via the standard submitAudit path,
 *      copying the AI submission's form_id + ticket links.
 *   2. Record a calibration data point (source='qa_sample_review')
 *      linking the AI submission and the new human submission.
 *
 * The AI submission stays as the system of record and is unchanged.
 */
router.post('/calibration-overlay/:submissionId', async (req: Request, res: Response) => {
  const aiSubmissionId = parsePositiveInt(req.params.submissionId);
  if (aiSubmissionId === null) {
    return res.status(400).json({ error: 'Invalid submission id; must be a positive integer.' });
  }
  const userId = req.user?.user_id;
  if (!userId) {
    return res.status(401).json({ error: 'Authenticated user required.' });
  }

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
  if (!answers || answers.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty answers[] array.' });
  }
  const metadata = Array.isArray(req.body?.metadata) ? req.body.metadata : undefined;
  const correctionReason = typeof req.body?.correction_reason === 'string' ? req.body.correction_reason : null;

  try {
    const aiSubmission = await prisma.submission.findUnique({
      where: { id: aiSubmissionId },
      include: {
        submission_answers: true,
        submission_ticket_tasks: true,
      },
    });
    if (!aiSubmission) {
      return res.status(404).json({ error: 'AI submission not found' });
    }
    if (aiSubmission.status !== 'SUBMITTED') {
      return res.status(409).json({
        error: `Calibration overlay requires a SUBMITTED AI source (got ${aiSubmission.status}).`,
        code: 'NOT_SUBMITTED',
      });
    }

    const ticketRefs = aiSubmission.submission_ticket_tasks.map((t) => ({
      kind: t.kind as 'TICKET' | 'TASK',
      external_id: Number(t.external_id),
    }));
    if (ticketRefs.length === 0) {
      return res.status(409).json({
        error: 'AI submission has no ticket/task link; cannot create a calibration overlay.',
        code: 'NO_TICKET_LINK',
      });
    }

    const humanSubmission = await submissionService.submitAudit(
      {
        form_id: aiSubmission.form_id,
        call_id: aiSubmission.call_id ?? null,
        submitted_by: userId,
        answers,
        metadata,
        ticket_tasks: ticketRefs,
      } as any,
      userId
    );

    const aiAnswers: Record<number, string> = {};
    for (const a of aiSubmission.submission_answers) {
      aiAnswers[a.question_id] = a.answer ?? '';
    }
    const humanAnswers: Record<number, string> = {};
    for (const a of answers) {
      humanAnswers[a.question_id] = a.answer ?? '';
    }

    const ticketRow = ticketRefs.find((t) => t.kind === 'TICKET') ?? ticketRefs[0];

    try {
      await aiCalibrationService.recordSampleReview({
        formId: aiSubmission.form_id,
        ticketId: ticketRow.external_id,
        aiSubmissionId,
        humanSubmissionId: humanSubmission.submission_id,
        aiAnswers,
        humanAnswers,
        gradedBy: userId,
        correctionReason,
      });
    } catch (calErr) {
      logger.warn(`[AI REVIEWER ROUTE] Sample review submission saved but calibration record failed: ${(calErr as Error).message}`);
    }

    return res.status(201).json({
      ai_submission_id: aiSubmissionId,
      human_submission_id: humanSubmission.submission_id,
      total_score: humanSubmission.total_score,
      message: 'Sample review recorded; AI submission left in place.',
    });
  } catch (err) {
    if (err instanceof SubmissionServiceError) {
      logger.warn(`[AI REVIEWER ROUTE] calibration-overlay ${err.code}: ${err.message}`);
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] calibration-overlay unexpected failure', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    return res.status(500).json({ error: 'Failed to record calibration overlay' });
  }
});

// ── Calibration tab endpoints (form-builder; in-place updates without
// bumping the form version, so flipping Calibrating ↔ Trusted doesn't
// generate a new form record) ───────────────────────────────────────────

/**
 * GET /api/ai-reviewer/calibration/forms/:formId/metrics?window=50
 *
 * Rolling agreement metrics for the calibration tab's headline number
 * and per-question breakdown.
 */
router.get('/calibration/forms/:formId/metrics', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'Invalid form id; must be a positive integer.' });
  }
  const windowParam = parsePositiveInt(req.query.window as string | undefined);
  const window = windowParam ?? 50;

  try {
    const metrics = await aiCalibrationService.getRollingMetrics(formId, window);
    // Drift window — stable larger window for comparison (default 200,
    // capped by what the agreement getter can return). Lets the
    // calibration tab show "last 50 vs last 200" without a second
    // round-trip from the UI.
    const driftWindow = Math.min(200, Math.max(window * 2, 100));
    const drift =
      driftWindow > window
        ? await aiCalibrationService.getRollingMetrics(formId, driftWindow)
        : null;

    return res.json({
      ...metrics,
      drift_compare: drift
        ? {
            window_size: drift.window_size,
            sample_count: drift.sample_count,
            overall_agreement: drift.overall_agreement,
          }
        : null,
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] metrics failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load calibration metrics' });
  }
});

/**
 * GET /api/ai-reviewer/calibration/forms/:formId/recent?limit=20
 *
 * Most recent calibration data points (with full ai/human answer maps)
 * for the calibration tab's diff table.
 */
router.get('/calibration/forms/:formId/recent', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'Invalid form id; must be a positive integer.' });
  }
  const limitParam = parsePositiveInt(req.query.limit as string | undefined);
  const limit = limitParam ?? 20;

  try {
    const rows = await aiCalibrationService.listRecent(formId, limit);
    return res.json({ items: rows });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] recent failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load recent calibration data' });
  }
});

/**
 * PATCH /api/ai-reviewer/calibration/forms/:formId/settings
 * Body: { ai_submit_as_draft?, ai_sample_review_pct?, ai_sample_low_score_always? }
 *
 * In-place update of calibration-related form columns. Does NOT bump
 * `forms.version` — these settings change the AI lifecycle without
 * altering the rubric.
 */
router.patch('/calibration/forms/:formId/settings', authorizeAdmin, async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'Invalid form id; must be a positive integer.' });
  }

  const updates: Record<string, unknown> = {};
  if (typeof req.body?.ai_submit_as_draft === 'boolean') {
    updates.ai_submit_as_draft = req.body.ai_submit_as_draft;
  }
  if (req.body?.ai_sample_review_pct != null) {
    const n = Number(req.body.ai_sample_review_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: 'ai_sample_review_pct must be 0..100.' });
    }
    updates.ai_sample_review_pct = Math.round(n);
  }
  if (typeof req.body?.ai_sample_low_score_always === 'boolean') {
    updates.ai_sample_low_score_always = req.body.ai_sample_low_score_always;
  }
  // ai_sample_low_confidence_threshold: nullable 0..1 decimal. NULL disables
  // the low-confidence auto-route. Accept either explicit null or a number.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ai_sample_low_confidence_threshold')) {
    const raw = req.body.ai_sample_low_confidence_threshold;
    if (raw === null || raw === '') {
      updates.ai_sample_low_confidence_threshold = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return res.status(400).json({ error: 'ai_sample_low_confidence_threshold must be 0..1 (or null).' });
      }
      updates.ai_sample_low_confidence_threshold = Math.round(n * 100) / 100;
    }
  }
  // ai_monthly_cost_budget_usd: nullable positive decimal. Per-form cap
  // for the calendar UTC month. Null disables the budget. AIReviewerCostGuard
  // soft-warns at 80% and hard-blocks at 100%. Phase 7b knob.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ai_monthly_cost_budget_usd')) {
    const raw = req.body.ai_monthly_cost_budget_usd;
    if (raw === null || raw === '') {
      updates.ai_monthly_cost_budget_usd = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        return res
          .status(400)
          .json({ error: 'ai_monthly_cost_budget_usd must be a non-negative number (or null).' });
      }
      // Round to two decimals (cents).
      updates.ai_monthly_cost_budget_usd = Math.round(n * 100) / 100;
    }
  }
  // ai_disagreement_route_threshold: 0..1 kappa floor; rows with at least
  // one question whose rolling kappa drops below this get routed to the
  // QA inbox even when their score / confidence look fine. Phase 6 knob.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ai_disagreement_route_threshold')) {
    const raw = req.body.ai_disagreement_route_threshold;
    if (raw === null || raw === '') {
      updates.ai_disagreement_route_threshold = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return res
          .status(400)
          .json({ error: 'ai_disagreement_route_threshold must be 0..1 (or null).' });
      }
      updates.ai_disagreement_route_threshold = Math.round(n * 100) / 100;
    }
  }
  // ai_review_guidance: accept string (trimmed/null-coerced) or explicit null to clear.
  // Hard-cap at AI_REVIEW_GUIDANCE_MAX_CHARS to prevent unbounded prompt growth via
  // the per-form addendum. If a rule needs more space than this, it belongs in a
  // rule pack (which has its own size budget), not in the per-form free-text slot.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ai_review_guidance')) {
    const raw = req.body.ai_review_guidance;
    if (raw !== null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'ai_review_guidance must be a string or null.' });
    }
    if (typeof raw === 'string' && raw.length > AI_REVIEW_GUIDANCE_MAX_CHARS) {
      return res.status(400).json({
        error: `ai_review_guidance must be ${AI_REVIEW_GUIDANCE_MAX_CHARS} characters or fewer (got ${raw.length}). Move long-form rules into a rule pack instead.`,
      });
    }
    // Mirror MySQLFormRepository.normalizeGuidance: trim, empty -> null. Use
    // aiEnabled=true here because this route already enforces ai_enabled below.
    updates.ai_review_guidance = normalizeGuidance(raw, true);
  }
  // ai_model_provider: enum of supported LLM providers. Lets the form
  // author A/B Claude vs ChatGPT and pin the winner without code changes.
  // Whitelist enforced here so a typo in the body can't write garbage
  // ("claude", "gpt", etc.) that would crash the synthesis pipeline at run
  // time. New providers (e.g. "gemini") get added here when wired in.
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ai_model_provider')) {
    const raw = req.body.ai_model_provider;
    const allowed = new Set(['anthropic', 'openai']);
    if (typeof raw !== 'string' || !allowed.has(raw)) {
      return res
        .status(400)
        .json({ error: `ai_model_provider must be one of: ${[...allowed].join(', ')}.` });
    }
    updates.ai_model_provider = raw;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Body must include at least one calibration setting.' });
  }

  try {
    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, ai_enabled: true },
    });
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }
    if (!form.ai_enabled) {
      return res.status(409).json({ error: 'Form is not AI-enabled.', code: 'AI_NOT_ENABLED' });
    }

    const updated = await prisma.form.update({
      where: { id: formId },
      data: updates,
      select: {
        id: true,
        ai_enabled: true,
        ai_review_guidance: true,
        ai_submit_as_draft: true,
        ai_sample_review_pct: true,
        ai_sample_low_score_always: true,
        ai_sample_low_confidence_threshold: true,
        ai_disagreement_route_threshold: true,
        ai_monthly_cost_budget_usd: true,
        ai_model_provider: true,
      },
    });
    logger.info(`[AI REVIEWER ROUTE] calibration settings updated for form ${formId}`, updates);

    // If guidance changed (i.e. the prompt content shipped to the model
    // is different), kick off a regression eval so we have a kappa
    // datapoint pinned to the new prompt. Fire-and-forget — eval can
    // take minutes; errors only log.
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_review_guidance')) {
      const userId = req.user?.user_id ?? null;
      void runGoldenEval({ formId, triggeredBy: 'system_prompt_change', triggeredByUser: userId }).catch((err) =>
        logger.error('[AI REVIEWER ROUTE] post-guidance eval failed', { error: (err as Error).message, formId })
      );
    }
    // If the budget changed, blow away the cached MTD so the next /cost
    // status call (and the next cost-guard pre-flight) reflects the new
    // cap immediately rather than waiting for the 60s cache TTL.
    if (Object.prototype.hasOwnProperty.call(updates, 'ai_monthly_cost_budget_usd')) {
      const { invalidateCostCache } = await import('../services/AIReviewerCostGuard');
      invalidateCostCache(formId);
    }
    return res.json(updated);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] settings update failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to update calibration settings' });
  }
});

/**
 * GET /api/ai-reviewer/forms
 *
 * Returns one row per `ai_enabled = true` form with the columns the
 * AI Reviewer management list needs: form metadata, mode flag, and a
 * rolling-agreement summary (overall, sample count, last 30d count).
 *
 * Includes inactive form versions on purpose — admins still need to be
 * able to inspect and manage AI guidance / calibration history for a
 * form whose live version has been turned off. The `version` column
 * disambiguates when multiple AI-enabled versions of the same form
 * exist.
 */
router.get('/forms', async (_req: Request, res: Response) => {
  try {
    const forms = await prisma.form.findMany({
      where: { ai_enabled: true },
      orderBy: [{ form_name: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        form_name: true,
        interaction_type: true,
        version: true,
        is_active: true,
        ai_review_guidance: true,
        ai_submit_as_draft: true,
        ai_sample_review_pct: true,
        ai_sample_low_score_always: true,
        ai_sample_low_confidence_threshold: true,
        ai_disagreement_route_threshold: true,
        ai_monthly_cost_budget_usd: true,
        ai_model_provider: true,
      },
    });

    // Per-form rolling agreement summary + readiness recommendation.
    // Use Promise.all because the expected count of AI-enabled forms is
    // small (single digits).
    const summaries = await Promise.all(
      forms.map(async (f) => {
        try {
          const [m, readiness] = await Promise.all([
            aiCalibrationService.getRollingMetrics(f.id, 50),
            aiCalibrationService.getModeReadiness(f.id),
          ]);
          return {
            overall_agreement: m.overall_agreement,
            sample_count: m.sample_count,
            last_30d_count: m.last_30d_count,
            readiness,
          };
        } catch (err) {
          logger.warn(`[AI REVIEWER ROUTE] metrics failed for form ${f.id}`, { error: (err as Error).message });
          return { overall_agreement: null, sample_count: 0, last_30d_count: 0, readiness: null };
        }
      })
    );

    const items = forms.map((f, i) => ({
      ...f,
      ...summaries[i],
    }));

    return res.json({ items });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] list AI forms failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to list AI-enabled forms' });
  }
});

/**
 * GET /api/ai-reviewer/forms/:formId/readiness
 *
 * Pure recommendation endpoint for the detail-page chip. Reuses the
 * same readiness logic that's inlined into the list response so the
 * detail page stays consistent with the list.
 */
router.get('/forms/:formId/readiness', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const readiness = await aiCalibrationService.getModeReadiness(formId);
    return res.json(readiness);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] readiness failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load mode readiness' });
  }
});

/**
 * GET /api/ai-reviewer/rule-packs
 *
 * Returns every rule pack available in the library (lightweight summary
 * for the chip picker — no body). Grouped by owner_dept on the client.
 */
router.get('/rule-packs', (_req: Request, res: Response) => {
  try {
    const items = rulePackService.listPackSummaries();
    return res.json({ items });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] rule-packs list failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to list rule packs' });
  }
});

/**
 * GET /api/ai-reviewer/forms/:formId/rule-packs
 *
 * Returns the rule pack keys currently assigned to a form (read from
 * the `ai_form_rule_pack_assignment` table via RulePackService cache).
 */
router.get('/forms/:formId/rule-packs', (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const keys = rulePackService.getPackKeysForForm(formId);
    return res.json({ form_id: formId, keys });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] form rule-packs read failed', {
      error: (err as Error).message,
      formId,
    });
    return res.status(500).json({ error: 'Failed to read form rule pack assignments' });
  }
});

/**
 * PUT /api/ai-reviewer/forms/:formId/rule-packs
 * Body: { keys: string[] }
 *
 * Replaces the rule pack assignment for a form. Validates every key
 * exists in the library before persisting.
 */
router.put('/forms/:formId/rule-packs', authorizeAdmin, async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  const keys = req.body?.keys;
  if (!Array.isArray(keys)) {
    return res.status(400).json({ error: 'Body must include { keys: string[] }.' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const saved = await rulePackService.setPackKeysForForm(formId, keys, userId);
    // Fire-and-forget regression eval so a content change immediately
    // produces an ai_eval_runs row. Don't block the response on it (eval
    // can take minutes); errors only log.
    void runGoldenEval({ formId, triggeredBy: 'rule_pack_change', triggeredByUser: userId }).catch((err) =>
      logger.error('[AI REVIEWER ROUTE] post-rule-pack eval failed', { error: (err as Error).message, formId })
    );
    return res.json({ form_id: formId, keys: saved });
  } catch (err) {
    if (err instanceof RulePackError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] form rule-packs write failed', {
      error: (err as Error).message,
      formId,
    });
    return res.status(500).json({ error: 'Failed to update form rule pack assignments' });
  }
});

/**
 * GET /api/ai-reviewer/forms/:formId/corrections-preview
 *
 * Returns the same correction set that will be injected into the next
 * AI run on this form. Drives the "What the AI is currently learning
 * from" panel on the AI Reviewer detail page so QA can see (and trust)
 * the closed loop.
 */
router.get('/forms/:formId/corrections-preview', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const corrections = await aiCalibrationService.getRecentCorrections(formId);
    return res.json({ items: corrections });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] corrections preview failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load corrections preview' });
  }
});

/**
 * GET /forms/:formId/absorbed-corrections — backs the "Show absorbed"
 * toggle in LearnedCorrectionsPanel. Returns absorbed correction rows
 * (those no longer being injected into prompts) so QA admins can audit
 * which lessons have been baked into rule packs vs. still teaching the
 * AI live.
 */
router.get('/forms/:formId/absorbed-corrections', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const items = await aiCalibrationService.getAbsorbedCorrections(formId);
    return res.json({ items });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] absorbed corrections failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load absorbed corrections' });
  }
});

/**
 * POST /calibration/:dataPointId/absorb — mark a single calibration
 * row as absorbed. Body: { reason: string }. The reason is required
 * (typically the rule-pack name + version where the lesson was baked
 * in) so the audit trail captures intent, not just the action.
 */
router.post('/calibration/:dataPointId/absorb', async (req: Request, res: Response) => {
  const dataPointId = parsePositiveInt(req.params.dataPointId);
  if (dataPointId === null) {
    return res.status(400).json({ error: 'dataPointId must be a positive integer' });
  }
  const userId = req.user?.user_id;
  if (!userId) {
    return res.status(401).json({ error: 'Authenticated user required' });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  try {
    const result = await aiCalibrationService.markAbsorbed({ dataPointId, userId, reason });
    return res.json(result);
  } catch (err) {
    if (err instanceof Error && (err as any).code) {
      const code = (err as any).code as string;
      const status = (err as any).statusCode as number | undefined;
      logger.warn(`[AI REVIEWER ROUTE] absorb rejected code=${code} dataPointId=${dataPointId}`);
      return res.status(status ?? 400).json({ error: err.message, code });
    }
    logger.error('[AI REVIEWER ROUTE] absorb failed', { error: (err as Error).message, dataPointId });
    return res.status(500).json({ error: 'Failed to absorb calibration row' });
  }
});

/**
 * POST /forms/:formId/calibration/reset — soft-archive every active
 * calibration row for a form. The only legitimate use case is a
 * material question rewrite that invalidates historical corrections.
 * Requires { reason, confirm: 'RESET' } in the body. Does not touch
 * other forms; rows stay in the table for audit purposes (they're
 * just removed from the rolling set).
 */
router.post('/forms/:formId/calibration/reset', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  const userId = req.user?.user_id;
  if (!userId) {
    return res.status(401).json({ error: 'Authenticated user required' });
  }
  const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
  if (confirm !== 'RESET') {
    return res.status(400).json({
      error: 'confirm must equal "RESET" — this destroys the form\'s rolling calibration set.',
    });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  try {
    const result = await aiCalibrationService.resetCalibrationForForm({ formId, userId, reason });
    return res.json(result);
  } catch (err) {
    if (err instanceof Error && (err as any).code) {
      const status = (err as any).statusCode as number | undefined;
      return res.status(status ?? 400).json({ error: err.message, code: (err as any).code });
    }
    logger.error('[AI REVIEWER ROUTE] calibration reset failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to reset calibration' });
  }
});

/**
 * GET /forms/:formId/golden-set — active golden set for a form,
 * enriched with score + ticket reference for the GoldenSetPage list.
 */
router.get('/forms/:formId/golden-set', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const items = await aiGoldenSetService.getActiveSet(formId);
    return res.json({ items });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] golden set list failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load golden set' });
  }
});

/**
 * POST /golden-set/manual — manually mark a submission as golden.
 * Body: { submission_id, notes? }. Idempotent on submission_id; if a
 * row already exists archived, it gets restored and re-flagged manual.
 */
router.post('/golden-set/manual', async (req: Request, res: Response) => {
  const submissionId = parsePositiveInt(req.body?.submission_id);
  if (submissionId === null) {
    return res.status(400).json({ error: 'submission_id must be a positive integer' });
  }
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Authenticated user required' });
  const notes = typeof req.body?.notes === 'string' ? req.body.notes : null;
  try {
    const row = await aiGoldenSetService.markManual({ submissionId, userId, notes });
    return res.json(row);
  } catch (err) {
    if (err instanceof AIGoldenSetServiceError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] golden manual mark failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to mark golden' });
  }
});

router.get('/golden-set/status/:submissionId', async (req: Request, res: Response) => {
  const submissionId = parsePositiveInt(req.params.submissionId);
  if (submissionId === null) {
    return res.status(400).json({ error: 'submissionId must be a positive integer' });
  }
  try {
    const status = await aiGoldenSetService.getStatusForSubmission(submissionId);
    return res.json(status);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] golden status failed', { error: (err as Error).message, submissionId });
    return res.status(500).json({ error: 'Failed to load status' });
  }
});

router.post('/golden-set/:id/archive', async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  try {
    const row = await aiGoldenSetService.archive({ id, reason });
    return res.json(row);
  } catch (err) {
    if (err instanceof AIGoldenSetServiceError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] golden archive failed', { error: (err as Error).message, id });
    return res.status(500).json({ error: 'Failed to archive golden row' });
  }
});

router.post('/golden-set/:id/restore', async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  try {
    const row = await aiGoldenSetService.restore(id);
    return res.json(row);
  } catch (err) {
    if (err instanceof AIGoldenSetServiceError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] golden restore failed', { error: (err as Error).message, id });
    return res.status(500).json({ error: 'Failed to restore golden row' });
  }
});

/**
 * POST /forms/:formId/eval/run — manually trigger an eval run against
 * the current golden set. Long-running (one analyze() per golden
 * submission), so the request can take a while; budget 5 min for the
 * client timeout.
 */
router.post('/forms/:formId/eval/run', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  const userId = req.user?.user_id ?? null;
  try {
    const result = await runGoldenEval({ formId, triggeredBy: 'manual', triggeredByUser: userId });
    return res.json(result);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] eval run failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/forms/:formId/eval/latest', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const row = await getLatestEvalRun(formId);
    return res.json(row);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] eval latest failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load latest eval run' });
  }
});

// ── Confidence calibration map (Phase 4) ──────────────────────────────
/**
 * GET /api/ai-reviewer/forms/:formId/kb-coverage?window=30
 *
 * Tier-2 Item 4 — KB Coverage dashboard. Reads recent AI submissions
 * for a form, walks each `ai_extras.pivots` array, and returns a
 * per-pivot rollup (cases, avg_kb_hits, gap flag). Pivots flagged as
 * `gap: true` are content gaps the Knowledge team can act on.
 *
 * Window defaults to 30 days; capped at 365 to keep the read cheap.
 */
router.get('/forms/:formId/kb-coverage', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  const windowRaw = parsePositiveInt(req.query.window);
  const windowDays = Math.min(365, windowRaw ?? 30);
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  try {
    const submissions = await prisma.submission.findMany({
      where: {
        form_id: formId,
        submitted_at: { gte: cutoff },
        // Submissions without ai_extras (e.g. human-only or pre-pivot
        // historical rows) contribute nothing to the rollup, so filter
        // them out at the DB layer to keep the read narrow.
        NOT: { ai_extras: { equals: null as any } },
      },
      select: { ai_extras: true },
    });
    const report = aggregateKbCoverage(formId, windowDays, submissions as { ai_extras?: unknown }[]);
    return res.json(report);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] kb-coverage fetch failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load KB coverage report' });
  }
});

router.get('/forms/:formId/calibration-map', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const [coverage, active, all] = await Promise.all([
      getCalibrationCoverage(formId),
      getActiveMapForForm(formId),
      prisma.aiCalibrationMap.findMany({
        where: { form_id: formId },
        orderBy: { version: 'desc' },
        take: 10,
      }),
    ]);
    return res.json({
      coverage,
      active: active
        ? { version: active.version, bins: active.bins, fallback: active.fallback }
        : null,
      versions: all.map((m) => ({
        id: m.id,
        version: m.version,
        fitted_at: m.fitted_at,
        sample_count: m.sample_count,
        is_active: m.is_active,
        notes: m.notes,
        bins: (m.bins_json as any)?.bins ?? [],
      })),
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map fetch failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load calibration map' });
  }
});

router.get('/forms/:formId/calibration-map/preview', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const preview = await previewCalibrationFit(formId);
    return res.json(preview);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map preview failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to preview calibration fit' });
  }
});

router.post('/forms/:formId/calibration-map/fit', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const result = await fitCalibrationMap({ formId });
    return res.json(result);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map fit failed', { error: (err as Error).message, formId });
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/forms/:formId/calibration-map/:mapId/activate', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  const mapId = parsePositiveInt(req.params.mapId);
  if (formId === null || mapId === null) {
    return res.status(400).json({ error: 'formId and mapId must be positive integers' });
  }
  try {
    const result = await activateCalibrationMap({ formId, mapId });
    return res.json(result);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] calibration map activate failed', { error: (err as Error).message, formId, mapId });
    return res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * GET /forms/:formId/preview-prompt
 *
 * "Show me what the AI sees" diagnostic. Returns the composed system prompt
 * the model would receive on the next run for this form, broken down by
 * section (universal base, rule packs, per-form guidance, learned
 * corrections) with char counts and a rough token estimate. The user
 * prompt is omitted because it's dominated by ticket-specific data which
 * isn't useful for the prompt-growth question.
 *
 * This is the single highest-leverage diagnostic for catching prompt bloat
 * before it shows up as cost/latency drift in production.
 */
router.get('/forms/:formId/preview-prompt', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const form = await prisma.form.findUnique({
      where: { id: formId },
      include: {
        form_categories: {
          include: { form_questions: { include: { radio_options: true } } },
          orderBy: { sort_order: 'asc' },
        },
      },
    });
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const formForPrompt = {
      id: form.id,
      form_name: form.form_name,
      interaction_type: form.interaction_type as string,
      ai_review_guidance: ((form as any).ai_review_guidance ?? null) as string | null,
      ai_base_prompt_id: ((form as any).ai_base_prompt_id ?? null) as number | null,
      categories: form.form_categories.map((c) => ({ id: c.id, category_name: c.category_name })),
      questions: form.form_categories.flatMap((c) =>
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
        }))
      ),
    };

    const corrections = await aiCalibrationService.getRecentCorrections(formId);
    const preview = previewSystemPrompt({ form: formForPrompt, corrections });

    return res.json({
      form_id: formId,
      // The assembled prompt is the single-source variant: Base body +
      // SINGLE_SOURCE_ADDENDUM (input shape + output schema). The same
      // Base body is used by the multi-source synthesis pass at runtime;
      // we don't preview that here because the user prompt for synthesis
      // (a list of per-source traces) is materially different and the
      // value of the preview is to show admins what THEY are authoring,
      // not the runtime envelope.
      assembled_for: 'single_source' as const,
      sections: {
        // The assembled Base text (Base body + SINGLE_SOURCE_ADDENDUM) is
        // shipped so the AI Prompt tab can show the actual prompt without
        // an extra round-trip. Other sections stay text-less because their
        // content is already editable via dedicated surfaces (rule packs,
        // guidance editor, corrections panel) and bloating this payload
        // would defeat the prompt-bloat diagnostic.
        system_base: { chars: preview.systemBase.chars, text: preview.systemBase.text },
        rule_packs: { chars: preview.packs.chars },
        per_form_guidance: { chars: preview.guidance.chars },
        learned_corrections: { chars: preview.corrections.chars, items: corrections.length },
      },
      total_chars: preview.totalChars,
      approx_tokens: preview.approxTokens,
      system_prompt_full: preview.systemFull,
      note: 'User prompt is omitted (dominated by ticket-specific data). Token estimate is ~4 chars/token; exact counts come from ai_call_logs after a real run.',
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] preview prompt failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to build prompt preview' });
  }
});

/**
 * GET /api/ai-reviewer/forms/:formId/drift
 *
 * Phase 7a: Per-form drift status. Returns the latest snapshot, baseline
 * statistics over the trailing 12-week window, any 2-SD alerts, and the
 * raw 90-day history for sparkline-style UI rendering.
 *
 * Snapshots are computed by AIDriftDetector daily; this endpoint just
 * reads the JSON history file. Empty history => fresh form, no alerts.
 */
/**
 * GET /api/ai-reviewer/forms/:formId/cost-status
 *
 * Phase 7b: Per-form MTD cost vs. configured monthly budget. Drives the
 * "Budget" gauge on the settings page and the page-header chip.
 */
router.get('/forms/:formId/cost-status', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const status = await getCostStatusForForm(formId);
    return res.json(status);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] cost status failed', {
      error: (err as Error).message,
      formId,
    });
    return res.status(500).json({ error: 'Failed to load cost status' });
  }
});

/**
 * GET /api/ai-reviewer/cost-rollup
 *
 * Cross-cutting (X1): observability rollups over `ai_call_logs`.
 *   - byPass[]:   per-pass volume / cost / latency over the window.
 *   - topCases[]: most expensive multi-source cases over the window.
 *
 * Optional query params:
 *   ?formId=...     scope to one form (defaults to all AI-enabled forms)
 *   ?days=30        window in days (default 30, capped at 180)
 *   ?caseLimit=25   how many top cases to return (default 25, max 200)
 */
router.get('/cost-rollup', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.query.formId);
  const daysRaw = Number(req.query.days);
  const caseLimitRaw = Number(req.query.caseLimit);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(180, Math.floor(daysRaw)) : 30;
  const caseLimit = Number.isFinite(caseLimitRaw) && caseLimitRaw > 0 ? Math.min(200, Math.floor(caseLimitRaw)) : 25;
  try {
    const { getPassRollup, getCaseRollup } = await import('../services/AICostObservability');
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const [byPass, topCases] = await Promise.all([
      getPassRollup({ formId, since }),
      getCaseRollup({ formId, since, caseLimit }),
    ]);
    return res.json({
      window_days: days,
      since: since.toISOString(),
      by_pass: byPass,
      top_cases: topCases,
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] cost rollup failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to load cost rollup' });
  }
});

/**
 * GET /api/ai-reviewer/_smoke
 *
 * Phase 8c: One-shot health summary. CI / monitoring hits this after a
 * deploy and asserts that every subsystem the AI Reviewer relies on
 * reports something sensible. Returns:
 *
 *   - prompt_revision: key + version of the active universal Base
 *                      prompt (from `ai_base_prompt` / `_version`).
 *   - ai_enabled_forms: count of forms with ai_enabled=true.
 *   - active_calibration_maps: how many forms have an active map.
 *   - golden_set_total: number of active (non-archived) golden rows.
 *   - latest_eval_run: kappa + pass for the most recent run on any form.
 *   - cost_budgets_configured: forms that opted in to the per-form cap.
 *   - drift_history_files: count of per-form drift JSON files that exist.
 *   - timestamp: server clock for skew detection.
 *
 * Intentionally read-only and deliberately lightweight (no LLM calls,
 * no writes). Exposes counts only — never per-form private data — so
 * it's safe to leave behind the existing /api gate without further auth
 * scoping.
 */
router.get('/_smoke', async (_req: Request, res: Response) => {
  try {
    const [aiEnabledForms, activeCalibMaps, goldenTotal, costBudgetForms, latestEvalRow] = await Promise.all([
      prisma.form.count({ where: { ai_enabled: true } }),
      prisma.aiCalibrationMap.count({ where: { is_active: true } }),
      prisma.aiGoldenSet.count({ where: { archived_at: null } }),
      prisma.form.count({
        where: { ai_enabled: true, ai_monthly_cost_budget_usd: { not: null } },
      }),
      prisma.aiEvalRun.findFirst({
        orderBy: { ran_at: 'desc' },
        select: {
          form_id: true,
          ran_at: true,
          overall_kappa: true,
          pass: true,
          golden_set_count: true,
        },
      }),
    ]);

    let driftHistoryFiles = 0;
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const dir = path.join(process.cwd(), 'data', 'drift');
      const entries = await fs.readdir(dir).catch(() => [] as string[]);
      driftHistoryFiles = entries.filter((f) => f.endsWith('.json')).length;
    } catch {
      driftHistoryFiles = 0;
    }

    let promptRevision: string;
    try {
      const base = basePromptService.getBaseForKind('base');
      promptRevision = `${base.key}@v${base.version}`;
    } catch (err) {
      logger.warn('[AI REVIEWER ROUTE] smoke could not resolve active base prompt', {
        error: (err as Error).message,
      });
      promptRevision = 'unknown';
    }

    return res.json({
      ok: true,
      prompt_revision: promptRevision,
      ai_enabled_forms: aiEnabledForms,
      active_calibration_maps: activeCalibMaps,
      golden_set_total: goldenTotal,
      cost_budgets_configured: costBudgetForms,
      drift_history_files: driftHistoryFiles,
      latest_eval_run: latestEvalRow
        ? {
            form_id: latestEvalRow.form_id,
            ran_at: latestEvalRow.ran_at,
            overall_kappa:
              latestEvalRow.overall_kappa != null ? Number(latestEvalRow.overall_kappa) : null,
            pass: latestEvalRow.pass,
            golden_set_count: latestEvalRow.golden_set_count,
          }
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] smoke endpoint failed', { error: (err as Error).message });
    return res.status(500).json({ ok: false, error: 'smoke check failed' });
  }
});

router.get('/forms/:formId/drift', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const status = await getDriftStatusForForm(formId);
    return res.json(status);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] drift status failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load drift status' });
  }
});

// =====================================================================
// Per-question rubrics — backed by `ai_form_question_rubric` (added in
// migration 20260513100000). The Question Rubrics card on the AI Reviewer
// Form Detail page calls these to author per-(form, question) grading
// bars that get rendered into the synthesis prompt by `renderFormSpec`.
// =====================================================================

/**
 * GET /api/ai-reviewer/forms/:formId/rubrics
 *
 * All authored rubrics for a form. Empty list is a normal state — most
 * questions don't have a rubric.
 */
router.get('/forms/:formId/rubrics', async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const rubrics = await listQuestionRubricsForForm(formId);
    return res.json({ form_id: formId, rubrics });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] list rubrics failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to list rubrics' });
  }
});

/**
 * PUT /api/ai-reviewer/forms/:formId/rubrics/:questionId
 * Body: { rubric_md: string }
 *
 * Upsert a rubric. Empty / whitespace-only `rubric_md` deletes the
 * rubric (rubrics are optional).
 */
router.put('/forms/:formId/rubrics/:questionId', authorizeAdmin, async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  const questionId = parsePositiveInt(req.params.questionId);
  if (formId === null || questionId === null) {
    return res.status(400).json({ error: 'formId and questionId must be positive integers' });
  }
  const rubricMd = typeof req.body?.rubric_md === 'string' ? req.body.rubric_md : null;
  if (rubricMd === null) {
    return res.status(400).json({ error: 'Body must include { rubric_md: string }.' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    await upsertQuestionRubric(formId, questionId, rubricMd, userId);
    const rubrics = await listQuestionRubricsForForm(formId);
    return res.json({ form_id: formId, rubrics });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] upsert rubric failed', {
      error: (err as Error).message,
      formId,
      questionId,
    });
    return res.status(500).json({ error: 'Failed to save rubric' });
  }
});

/**
 * DELETE /api/ai-reviewer/forms/:formId/rubrics/:questionId
 *
 * Remove the rubric for one question. Idempotent (no-op when absent).
 */
router.delete('/forms/:formId/rubrics/:questionId', authorizeAdmin, async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  const questionId = parsePositiveInt(req.params.questionId);
  if (formId === null || questionId === null) {
    return res.status(400).json({ error: 'formId and questionId must be positive integers' });
  }
  try {
    await deleteQuestionRubric(formId, questionId);
    return res.json({ form_id: formId, question_id: questionId, deleted: true });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] delete rubric failed', {
      error: (err as Error).message,
      formId,
      questionId,
    });
    return res.status(500).json({ error: 'Failed to delete rubric' });
  }
});

// =====================================================================
// Rule pack library CRUD — backed by `ai_rule_pack` (added in migration
// 20260513100000). The Rule Pack Library page (`RulePackLibrary.tsx`)
// calls these to author pack bodies. The chip picker on the form
// detail page lists active packs via the existing `GET /rule-packs`
// summary endpoint above.
// =====================================================================

/**
 * GET /api/ai-reviewer/rule-packs/all?include_archived=1
 *
 * Full pack rows (including body_md + always_include_urls) for the
 * library page. Different from the existing `/rule-packs` summary
 * endpoint that only returns the slim shape needed by the chip picker.
 */
router.get('/rule-packs/all', async (req: Request, res: Response) => {
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  try {
    const items = await rulePackService.listAllPacks(includeArchived);
    return res.json({ items });
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] rule-pack library list failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to list rule packs' });
  }
});

/**
 * GET /api/ai-reviewer/rule-packs/:id
 *
 * One pack by id, for the editor drawer.
 */
router.get('/rule-packs/:id', async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  try {
    const pack = await rulePackService.getPackById(id);
    if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
    return res.json(pack);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] rule-pack get failed', { error: (err as Error).message, id });
    return res.status(500).json({ error: 'Failed to load rule pack' });
  }
});

/**
 * POST /api/ai-reviewer/rule-packs
 * Body: { key, name, owner_dept, body_md, always_include_urls }
 *
 * Create a new rule pack. `key` must be unique and slug-safe.
 */
router.post('/rule-packs', authorizeAdmin, async (req: Request, res: Response) => {
  const userId = req.user?.user_id ?? null;
  try {
    const pack = await rulePackService.upsertPack({
      key: req.body?.key,
      name: req.body?.name,
      owner_dept: req.body?.owner_dept,
      body_md: req.body?.body_md,
      always_include_urls: req.body?.always_include_urls ?? [],
      updated_by: userId,
    });
    return res.status(201).json(pack);
  } catch (err) {
    if (err instanceof RulePackError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] rule-pack create failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to create rule pack' });
  }
});

/**
 * PUT /api/ai-reviewer/rule-packs/:id
 * Body: { name?, owner_dept?, body_md?, always_include_urls? }
 *
 * Update a pack's content. `key` is immutable post-creation (it's the
 * stable identifier referenced by chip-picker assignments and historic
 * eval-run pack hashes).
 */
router.put('/rule-packs/:id', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const existing = await rulePackService.getPackById(id);
    if (!existing) return res.status(404).json({ error: 'Rule pack not found' });
    const pack = await rulePackService.upsertPack({
      key: existing.key,
      name: req.body?.name ?? existing.name,
      owner_dept: req.body?.owner_dept ?? existing.owner_dept,
      body_md: req.body?.body_md ?? existing.body,
      always_include_urls: req.body?.always_include_urls ?? existing.always_include_urls,
      updated_by: userId,
    });
    return res.json(pack);
  } catch (err) {
    if (err instanceof RulePackError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] rule-pack update failed', { error: (err as Error).message, id });
    return res.status(500).json({ error: 'Failed to update rule pack' });
  }
});

/**
 * DELETE /api/ai-reviewer/rule-packs/:id
 *
 * Soft-delete (sets is_archived=true). Form assignments referencing
 * this pack are silently skipped on read until they're re-pointed via
 * the chip picker.
 */
router.delete('/rule-packs/:id', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const pack = await rulePackService.archivePack(id, userId);
    return res.json(pack);
  } catch (err) {
    if (err instanceof RulePackError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] rule-pack archive failed', { error: (err as Error).message, id });
    return res.status(500).json({ error: 'Failed to archive rule pack' });
  }
});

/**
 * POST /api/ai-reviewer/rule-packs/:id/restore
 *
 * Un-archive (clears is_archived). Used when an admin archives by
 * mistake; not exposed as a destructive method to keep the API
 * intent-explicit.
 */
router.post('/rule-packs/:id/restore', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const pack = await rulePackService.unarchivePack(id, userId);
    return res.json(pack);
  } catch (err) {
    if (err instanceof RulePackError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    logger.error('[AI REVIEWER ROUTE] rule-pack restore failed', { error: (err as Error).message, id });
    return res.status(500).json({ error: 'Failed to restore rule pack' });
  }
});

// =====================================================================
// Base Prompt Library — DB-managed `ai_base_prompt` + `ai_base_prompt_version`
// (added in 20260515080000). The Base Prompt Library page authors body
// content for the universal base layer of the 4-layer prompt model.
// All write endpoints are Admin-only; reads are open to any authenticated
// user so QA can preview the resolved prompt for any form.
// =====================================================================

const VALID_PROMPT_KINDS = new Set<PromptKind>(['base', 'trace']);

function parsePromptKind(raw: unknown): PromptKind | null {
  if (typeof raw !== 'string') return null;
  return VALID_PROMPT_KINDS.has(raw as PromptKind) ? (raw as PromptKind) : null;
}

function handleBasePromptError(res: Response, err: unknown, fallback: string, ctx?: Record<string, unknown>): Response {
  if (err instanceof BasePromptError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  logger.error(`[AI REVIEWER ROUTE] ${fallback}`, { error: (err as Error).message, ...(ctx ?? {}) });
  return res.status(500).json({ error: fallback });
}

/**
 * GET /api/ai-reviewer/base-prompts?kind=base&include_archived=1
 *
 * Lists base prompts for the Library page. Defaults to `kind=base` (the
 * single admin-editable Base prompt) when no kind is supplied; engineers
 * can pass `?kind=trace` to inspect the infrastructure trace prompt.
 * Legacy single_source / synthesis kinds are no longer issuable; archived
 * rows of those kinds are filtered out by `is_archived`.
 */
router.get('/base-prompts', async (req: Request, res: Response) => {
  const kind = req.query.kind ? parsePromptKind(req.query.kind) : ('base' as PromptKind);
  if (req.query.kind && !kind) {
    return res.status(400).json({ error: 'kind must be one of base | trace' });
  }
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  try {
    const items = await basePromptService.listBases({ kind: kind ?? undefined, includeArchived });
    return res.json({ items });
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to list base prompts');
  }
});

/**
 * GET /api/ai-reviewer/base-prompts/:id
 *
 * Full row including the current version body. Used by both the per-form
 * UniversalBaseCard preview and the library editor.
 */
router.get('/base-prompts/:id', async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  try {
    const base = await basePromptService.getBaseById(id);
    if (!base) return res.status(404).json({ error: 'Base prompt not found' });
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to load base prompt', { id });
  }
});

/**
 * GET /api/ai-reviewer/base-prompts/:id/history?limit=20
 *
 * Version history for the rollback drawer. Newest first.
 */
router.get('/base-prompts/:id/history', async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const limit = parsePositiveInt(req.query.limit) ?? 20;
  try {
    const items = await basePromptService.getBaseHistory(id, limit);
    return res.json({ items });
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to load base prompt history', { id });
  }
});

/**
 * POST /api/ai-reviewer/base-prompts (Admin)
 * Body: { key, name, description?, prompt_kind, body_md, change_note?, set_as_default? }
 *
 * Create a new base. New rows are NEVER set as default unless the body
 * explicitly opts in via `set_as_default: true` — surprise-default flips
 * would invalidate every form's prompt_hash.
 */
router.post('/base-prompts', authorizeAdmin, async (req: Request, res: Response) => {
  const userId = req.user?.user_id ?? null;
  const promptKind = parsePromptKind(req.body?.prompt_kind);
  if (!promptKind) {
    return res.status(400).json({ error: 'prompt_kind must be one of base | trace' });
  }
  try {
    const base = await basePromptService.upsertBase({
      key: req.body?.key,
      name: req.body?.name,
      description: req.body?.description,
      prompt_kind: promptKind,
      body_md: req.body?.body_md,
      change_note: req.body?.change_note,
      set_as_default: req.body?.set_as_default === true,
      updated_by: userId,
    });
    return res.status(201).json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to create base prompt');
  }
});

/**
 * PUT /api/ai-reviewer/base-prompts/:id (Admin)
 * Body: { name?, description?, body_md, change_note?, set_as_default? }
 *
 * Edit an existing base. ALWAYS creates a new version row — history is
 * forward-only, edits never overwrite. `key` and `prompt_kind` are
 * immutable post-creation (they're stable identifiers downstream).
 */
router.put('/base-prompts/:id', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const userId = req.user?.user_id ?? null;
  try {
    const existing = await basePromptService.getBaseById(id);
    if (!existing) return res.status(404).json({ error: 'Base prompt not found' });
    const base = await basePromptService.upsertBase({
      id,
      key: existing.key,
      name: req.body?.name ?? existing.name,
      description: req.body?.description !== undefined ? req.body.description : existing.description,
      prompt_kind: existing.prompt_kind,
      body_md: req.body?.body_md ?? existing.body,
      change_note: req.body?.change_note ?? null,
      set_as_default: req.body?.set_as_default === true,
      updated_by: userId,
    });
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to update base prompt', { id });
  }
});

/**
 * POST /api/ai-reviewer/base-prompts/:id/archive (Admin)
 *
 * Soft-delete. The default base for its kind cannot be archived; flip
 * the default to another base first.
 */
router.post('/base-prompts/:id/archive', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const userId = req.user?.user_id ?? null;
  try {
    const base = await basePromptService.archiveBase(id, userId);
    if (!base) return res.status(404).json({ error: 'Base prompt not found' });
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to archive base prompt', { id });
  }
});

/**
 * POST /api/ai-reviewer/base-prompts/:id/rollback/:versionId (Admin)
 *
 * Restore an older version's body as a NEW current version. Forward-only
 * history — the original old row is preserved; the new row is a copy of
 * its body with `change_note: "Rollback to v<n>"`.
 */
router.post('/base-prompts/:id/rollback/:versionId', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  const versionId = parsePositiveInt(req.params.versionId);
  if (id === null || versionId === null) {
    return res.status(400).json({ error: 'id and versionId must be positive integers' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const base = await basePromptService.rollbackToVersion(id, versionId, userId);
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to roll back base prompt', { id, versionId });
  }
});

/**
 * POST /api/ai-reviewer/base-prompts/:id/set-default (Admin)
 *
 * Atomically marks this base as THE default for its prompt_kind, clearing
 * the previous default in the same transaction.
 */
router.post('/base-prompts/:id/set-default', authorizeAdmin, async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const userId = req.user?.user_id ?? null;
  try {
    const base = await basePromptService.setDefaultForKind(id, userId);
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to set default base prompt', { id });
  }
});

// PUT /forms/:formId/base-prompt was retired in migration 20260515090000:
// the Base prompt is universal; forms cannot override it.

export default router;
