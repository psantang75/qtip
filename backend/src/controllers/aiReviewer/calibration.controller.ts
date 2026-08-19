import { Request, Response } from 'express';
import aiCalibrationService from '../../services/AICalibrationService';
import { normalizeGuidance } from '../../repositories/MySQLFormRepository';
import { runGoldenEval } from '../../services/AIGoldenEvalRunner';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Calibration controller.
 *
 * The "Calibration tab" surface: rolling agreement metrics, the recent
 * data-point diff table, in-place calibration/lifecycle form settings, and
 * the learned-corrections lifecycle (preview / absorbed / absorb / reset),
 * backed by `AICalibrationService`. Extracted verbatim from
 * `ai-reviewer.routes.ts` (routes-thinning slice); behavior, status codes,
 * and response shapes are unchanged. The submission-flow `/calibration-overlay`
 * endpoint deliberately stays in the routes file — it is dominated by
 * `SubmissionService` logic (it creates a submission) and belongs with the
 * run/inbox handlers, not this calibration-tab CRUD.
 */

/**
 * Hard cap on the per-form `ai_review_guidance` free-text addendum, in chars.
 * The guidance field is the lowest-friction place for prompt growth to sneak
 * in (a QA admin can paste an entire wiki page into it). 2000 chars (~500
 * tokens) is plenty for a paragraph of form-specific guidance; anything
 * longer should live in a versioned rule pack instead, where it's reviewable
 * in git and counted against the rule-pack budget.
 */
const AI_REVIEW_GUIDANCE_MAX_CHARS = 2000;

/**
 * GET /api/ai-reviewer/calibration/forms/:formId/metrics?window=50
 *
 * Rolling agreement metrics for the calibration tab's headline number
 * and per-question breakdown.
 */
export const getCalibrationMetrics = async (req: Request, res: Response) => {
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
};

/**
 * GET /api/ai-reviewer/calibration/forms/:formId/recent?limit=20
 *
 * Most recent calibration data points (with full ai/human answer maps)
 * for the calibration tab's diff table.
 */
export const getRecentCalibration = async (req: Request, res: Response) => {
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
};

/**
 * PATCH /api/ai-reviewer/calibration/forms/:formId/settings
 * Body: { ai_submit_as_draft?, ai_sample_review_pct?, ai_sample_low_score_always? }
 *
 * In-place update of calibration-related form columns. Does NOT bump
 * `forms.version` — these settings change the AI lifecycle without
 * altering the rubric.
 */
export const updateCalibrationSettings = async (req: Request, res: Response) => {
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
      const { invalidateCostCache } = await import('../../services/AIReviewerCostGuard');
      invalidateCostCache(formId);
    }
    return res.json(updated);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] settings update failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to update calibration settings' });
  }
};

/**
 * GET /api/ai-reviewer/forms/:formId/corrections-preview
 *
 * Returns the same correction set that will be injected into the next
 * AI run on this form. Drives the "What the AI is currently learning
 * from" panel on the AI Reviewer detail page so QA can see (and trust)
 * the closed loop.
 */
export const getCorrectionsPreview = async (req: Request, res: Response) => {
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
};

/**
 * GET /forms/:formId/absorbed-corrections — backs the "Show absorbed"
 * toggle in LearnedCorrectionsPanel. Returns absorbed correction rows
 * (those no longer being injected into prompts) so QA admins can audit
 * which lessons have been baked into rule packs vs. still teaching the
 * AI live.
 */
export const getAbsorbedCorrections = async (req: Request, res: Response) => {
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
};

/**
 * POST /calibration/:dataPointId/absorb — mark a single calibration
 * row as absorbed. Body: { reason: string }. The reason is required
 * (typically the rule-pack name + version where the lesson was baked
 * in) so the audit trail captures intent, not just the action.
 */
export const absorbCalibrationRow = async (req: Request, res: Response) => {
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
};

/**
 * POST /forms/:formId/calibration/reset — soft-archive every active
 * calibration row for a form. The only legitimate use case is a
 * material question rewrite that invalidates historical corrections.
 * Requires { reason, confirm: 'RESET' } in the body. Does not touch
 * other forms; rows stay in the table for audit purposes (they're
 * just removed from the rolling set).
 */
export const resetFormCalibration = async (req: Request, res: Response) => {
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
};
