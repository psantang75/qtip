import { Request, Response } from 'express';
import { runGoldenEval, getLatestEvalRun } from '../../services/AIGoldenEvalRunner';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Golden-eval run controller.
 *
 * Manually triggers a regression eval against a form's current golden set
 * and reads back the latest run, backed by `AIGoldenEvalRunner`. Extracted
 * verbatim from `ai-reviewer.routes.ts` (routes-thinning slice after
 * base-prompts / rule-packs / golden-set); behavior, status codes, and
 * response shapes are unchanged. These handlers have no dedicated error
 * class — they log and return a plain 500 — so there is no shared
 * `handle*Error` helper here (unlike the sibling controllers). `runGoldenEval`
 * is also invoked fire-and-forget from other routes (system-prompt / rule-pack
 * changes); this controller owns only the explicit manual-run endpoints.
 */

/**
 * POST /forms/:formId/eval/run — manually trigger an eval run against
 * the current golden set. Long-running (one analyze() per golden
 * submission), so the request can take a while; budget 5 min for the
 * client timeout.
 */
export const runFormEval = async (req: Request, res: Response) => {
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
};

export const getLatestFormEval = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) return res.status(400).json({ error: 'formId must be a positive integer' });
  try {
    const row = await getLatestEvalRun(formId);
    return res.json(row);
  } catch (err) {
    logger.error('[AI REVIEWER ROUTE] eval latest failed', { error: (err as Error).message, formId });
    return res.status(500).json({ error: 'Failed to load latest eval run' });
  }
};
