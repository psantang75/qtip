import { Request, Response } from 'express';
import aiGoldenSetService, { AIGoldenSetServiceError } from '../../services/AIGoldenSetService';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Golden Set controller.
 *
 * The golden set is the curated pool of submissions a form's regression
 * evals run against. Handlers cover listing a form's active set, manually
 * flagging a submission as golden, checking a submission's golden status,
 * and archive/restore of individual rows — all backed by
 * `AIGoldenSetService`. Extracted verbatim from `ai-reviewer.routes.ts`
 * (routes-thinning slice after base-prompts + rule-packs); behavior, status
 * codes, and response shapes are unchanged. The duplicated
 * `AIGoldenSetServiceError → HTTP` mapping is consolidated into one
 * `handleGoldenSetError` helper, mirroring the sibling controllers. These
 * endpoints predate the global `AppError` envelope; migrating them to it is
 * a follow-up, not part of this move.
 */

function handleGoldenSetError(res: Response, err: unknown, fallback: string, ctx?: Record<string, unknown>): Response {
  if (err instanceof AIGoldenSetServiceError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  logger.error(`[AI REVIEWER ROUTE] ${fallback}`, { error: (err as Error).message, ...(ctx ?? {}) });
  return res.status(500).json({ error: fallback });
}

/**
 * GET /forms/:formId/golden-set — active golden set for a form,
 * enriched with score + ticket reference for the GoldenSetPage list.
 */
export const getFormGoldenSet = async (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const items = await aiGoldenSetService.getActiveSet(formId);
    return res.json({ items });
  } catch (err) {
    return handleGoldenSetError(res, err, 'Failed to load golden set', { formId });
  }
};

/**
 * POST /golden-set/manual — manually mark a submission as golden.
 * Body: { submission_id, notes? }. Idempotent on submission_id; if a
 * row already exists archived, it gets restored and re-flagged manual.
 */
export const markGoldenManual = async (req: Request, res: Response) => {
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
    return handleGoldenSetError(res, err, 'Failed to mark golden');
  }
};

export const getGoldenStatus = async (req: Request, res: Response) => {
  const submissionId = parsePositiveInt(req.params.submissionId);
  if (submissionId === null) {
    return res.status(400).json({ error: 'submissionId must be a positive integer' });
  }
  try {
    const status = await aiGoldenSetService.getStatusForSubmission(submissionId);
    return res.json(status);
  } catch (err) {
    return handleGoldenSetError(res, err, 'Failed to load status', { submissionId });
  }
};

export const archiveGolden = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  try {
    const row = await aiGoldenSetService.archive({ id, reason });
    return res.json(row);
  } catch (err) {
    return handleGoldenSetError(res, err, 'Failed to archive golden row', { id });
  }
};

export const restoreGolden = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  try {
    const row = await aiGoldenSetService.restore(id);
    return res.json(row);
  } catch (err) {
    return handleGoldenSetError(res, err, 'Failed to restore golden row', { id });
  }
};
