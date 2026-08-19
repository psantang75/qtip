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
import basePromptService from '../services/BasePromptService';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { parsePositiveInt } from '../controllers/aiReviewer/shared';
import * as basePromptsController from '../controllers/aiReviewer/basePrompts.controller';
import * as rulePacksController from '../controllers/aiReviewer/rulePacks.controller';
import * as goldenSetController from '../controllers/aiReviewer/goldenSet.controller';
import * as evalRunsController from '../controllers/aiReviewer/evalRuns.controller';
import * as calibrationMapController from '../controllers/aiReviewer/calibrationMap.controller';
import * as rubricsController from '../controllers/aiReviewer/rubrics.controller';
import * as calibrationController from '../controllers/aiReviewer/calibration.controller';
import * as formsDiagnosticsController from '../controllers/aiReviewer/formsDiagnostics.controller';

const router = express.Router();
router.use(authenticate);
// Every AI Reviewer endpoint requires the `quality_ai_reviewer` page grant.
// Per-endpoint `authorizeAdmin` calls below stay as a stricter overlay for
// admin-only operations (rubric edits, prompt management, etc.).
// `quality_ai_inbox` is a separate page key — the /inbox endpoint below also
// requires it; the AI Inbox page in the UI is gated to that key.
router.use(authorizePage('quality_ai_reviewer', 'viewAll'));

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
// generate a new form record) → controllers/aiReviewer/calibration.controller.ts
router.get('/calibration/forms/:formId/metrics', calibrationController.getCalibrationMetrics);
router.get('/calibration/forms/:formId/recent', calibrationController.getRecentCalibration);
router.patch('/calibration/forms/:formId/settings', authorizeAdmin, calibrationController.updateCalibrationSettings);

// Form read/diagnostics routes → controllers/aiReviewer/formsDiagnostics.controller.ts.
router.get('/forms', formsDiagnosticsController.listAiForms);
router.get('/forms/:formId/readiness', formsDiagnosticsController.getFormReadiness);

// Rule-pack routes are wired to controllers/aiReviewer/rulePacks.controller.ts.
router.get('/rule-packs', rulePacksController.listRulePackSummaries);

router.get('/forms/:formId/rule-packs', rulePacksController.getFormRulePacks);
router.put('/forms/:formId/rule-packs', authorizeAdmin, rulePacksController.setFormRulePacks);

// Learned-corrections + calibration-row lifecycle → calibration.controller.ts.
router.get('/forms/:formId/corrections-preview', calibrationController.getCorrectionsPreview);
router.get('/forms/:formId/absorbed-corrections', calibrationController.getAbsorbedCorrections);
router.post('/calibration/:dataPointId/absorb', calibrationController.absorbCalibrationRow);
router.post('/forms/:formId/calibration/reset', calibrationController.resetFormCalibration);

// Golden-set routes → controllers/aiReviewer/goldenSet.controller.ts.
router.get('/forms/:formId/golden-set', goldenSetController.getFormGoldenSet);
router.post('/golden-set/manual', goldenSetController.markGoldenManual);
router.get('/golden-set/status/:submissionId', goldenSetController.getGoldenStatus);
router.post('/golden-set/:id/archive', goldenSetController.archiveGolden);
router.post('/golden-set/:id/restore', goldenSetController.restoreGolden);

// Golden-eval run routes → controllers/aiReviewer/evalRuns.controller.ts.
router.post('/forms/:formId/eval/run', evalRunsController.runFormEval);
router.get('/forms/:formId/eval/latest', evalRunsController.getLatestFormEval);

// ── Confidence calibration map (Phase 4) ──────────────────────────────
router.get('/forms/:formId/kb-coverage', formsDiagnosticsController.getKbCoverage);

// Calibration-map routes → controllers/aiReviewer/calibrationMap.controller.ts.
router.get('/forms/:formId/calibration-map', calibrationMapController.getCalibrationMap);
router.get('/forms/:formId/calibration-map/preview', calibrationMapController.previewCalibrationMapFit);
router.post('/forms/:formId/calibration-map/fit', calibrationMapController.fitCalibrationMapHandler);
router.post('/forms/:formId/calibration-map/:mapId/activate', calibrationMapController.activateCalibrationMapHandler);

router.get('/forms/:formId/preview-prompt', formsDiagnosticsController.getPreviewPrompt);

router.get('/forms/:formId/cost-status', formsDiagnosticsController.getCostStatus);
router.get('/cost-rollup', formsDiagnosticsController.getCostRollup);

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

router.get('/forms/:formId/drift', formsDiagnosticsController.getDriftStatus);

// =====================================================================
// Per-question rubrics — backed by `ai_form_question_rubric` (added in
// migration 20260513100000). The Question Rubrics card on the AI Reviewer
// Form Detail page calls these to author per-(form, question) grading
// bars that get rendered into the synthesis prompt by `renderFormSpec`.
// =====================================================================

// Per-question rubric routes → controllers/aiReviewer/rubrics.controller.ts.
router.get('/forms/:formId/rubrics', rubricsController.listRubrics);
router.put('/forms/:formId/rubrics/:questionId', authorizeAdmin, rubricsController.upsertRubric);
router.delete('/forms/:formId/rubrics/:questionId', authorizeAdmin, rubricsController.deleteRubric);

// =====================================================================
// Rule pack library CRUD + per-form assignment — backed by `ai_rule_pack`
// and `ai_form_rule_pack_assignment`. Handlers live in
// controllers/aiReviewer/rulePacks.controller.ts; routes stay thin here.
// `/rule-packs/all` MUST stay registered before `/rule-packs/:id`.
// =====================================================================

router.get('/rule-packs/all', rulePacksController.listAllRulePacks);
router.get('/rule-packs/:id', rulePacksController.getRulePack);
router.post('/rule-packs', authorizeAdmin, rulePacksController.createRulePack);
router.put('/rule-packs/:id', authorizeAdmin, rulePacksController.updateRulePack);
router.delete('/rule-packs/:id', authorizeAdmin, rulePacksController.deleteRulePack);
router.post('/rule-packs/:id/restore', authorizeAdmin, rulePacksController.restoreRulePack);

// =====================================================================
// Base Prompt Library — DB-managed `ai_base_prompt` + `ai_base_prompt_version`
// (added in 20260515080000). Handlers live in
// controllers/aiReviewer/basePrompts.controller.ts; routes stay thin here.
// All write endpoints are Admin-only; reads are open to any authenticated
// user so QA can preview the resolved prompt for any form.
// =====================================================================

router.get('/base-prompts', basePromptsController.listBasePrompts);
router.get('/base-prompts/:id', basePromptsController.getBasePrompt);
router.get('/base-prompts/:id/history', basePromptsController.getBasePromptHistory);
router.post('/base-prompts', authorizeAdmin, basePromptsController.createBasePrompt);
router.put('/base-prompts/:id', authorizeAdmin, basePromptsController.updateBasePrompt);
router.post('/base-prompts/:id/archive', authorizeAdmin, basePromptsController.archiveBasePrompt);
router.post('/base-prompts/:id/rollback/:versionId', authorizeAdmin, basePromptsController.rollbackBasePrompt);
router.post('/base-prompts/:id/set-default', authorizeAdmin, basePromptsController.setDefaultBasePrompt);

// PUT /forms/:formId/base-prompt was retired in migration 20260515090000:
// the Base prompt is universal; forms cannot override it.

export default router;
