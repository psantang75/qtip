import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import aiCalibrationService from '../../services/AICalibrationService';
import { previewSystemPrompt } from '../../services/aiReviewerPrompt';
import { aggregateKbCoverage } from '../../services/KbCoverageAggregator';
import { getDriftStatusForForm } from '../../services/AIDriftDetector';
import { getCostStatusForForm } from '../../services/AIReviewerCostGuard';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — form-scoped read / diagnostics controller.
 *
 * The read-only surfaces behind the AI Reviewer management list and the
 * per-form detail page's diagnostic cards: the AI-enabled forms list (with
 * rolling-agreement summary + mode readiness), the standalone readiness chip,
 * the "what the AI sees" prompt preview, the KB-coverage rollup, and the
 * cost/drift observability reads. Extracted verbatim from
 * `ai-reviewer.routes.ts` (final routes-thinning slice); behavior, status
 * codes, and response shapes are unchanged. These handlers log and return a
 * plain 500 (no dedicated error class). The submission-flow handlers
 * (`/run`, `/inbox`, `/ticket`, `/draft`, `/promote-draft`,
 * `/calibration-overlay`) and the global `/health` + `/_smoke` monitoring
 * endpoints deliberately stay in the routes file.
 */

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
export const listAiForms = async (_req: Request, res: Response) => {
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
};

/**
 * GET /api/ai-reviewer/forms/:formId/readiness
 *
 * Pure recommendation endpoint for the detail-page chip. Reuses the
 * same readiness logic that's inlined into the list response so the
 * detail page stays consistent with the list.
 */
export const getFormReadiness = async (req: Request, res: Response) => {
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
};

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
export const getKbCoverage = async (req: Request, res: Response) => {
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
};

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
export const getPreviewPrompt = async (req: Request, res: Response) => {
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
};

/**
 * GET /api/ai-reviewer/forms/:formId/cost-status
 *
 * Phase 7b: Per-form MTD cost vs. configured monthly budget. Drives the
 * "Budget" gauge on the settings page and the page-header chip.
 */
export const getCostStatus = async (req: Request, res: Response) => {
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
};

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
export const getCostRollup = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.query.formId);
  const daysRaw = Number(req.query.days);
  const caseLimitRaw = Number(req.query.caseLimit);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(180, Math.floor(daysRaw)) : 30;
  const caseLimit = Number.isFinite(caseLimitRaw) && caseLimitRaw > 0 ? Math.min(200, Math.floor(caseLimitRaw)) : 25;
  try {
    const { getPassRollup, getCaseRollup } = await import('../../services/AICostObservability');
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
};

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
export const getDriftStatus = async (req: Request, res: Response) => {
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
};
