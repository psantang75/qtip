import { Request, Response } from 'express';
import {
  listQuestionRubricsForForm,
  upsertQuestionRubric,
  deleteQuestionRubric,
} from '../../services/aiReviewerPrompt';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Per-question rubric controller.
 *
 * CRUD over `ai_form_question_rubric` — the per-(form, question) grading
 * bars authored on the AI Reviewer Form Detail page and rendered into the
 * synthesis prompt by `renderFormSpec`. Extracted verbatim from
 * `ai-reviewer.routes.ts` (routes-thinning slice after base-prompts /
 * rule-packs / golden-set / eval-run / calibration-map); behavior, status
 * codes, and response shapes are unchanged. These handlers log and return a
 * plain 500 (no dedicated error class), so there is no shared `handle*Error`
 * helper here.
 */

/**
 * GET /api/ai-reviewer/forms/:formId/rubrics
 *
 * All authored rubrics for a form. Empty list is a normal state — most
 * questions don't have a rubric.
 */
export const listRubrics = async (req: Request, res: Response) => {
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
};

/**
 * PUT /api/ai-reviewer/forms/:formId/rubrics/:questionId
 * Body: { rubric_md: string }
 *
 * Upsert a rubric. Empty / whitespace-only `rubric_md` deletes the
 * rubric (rubrics are optional).
 */
export const upsertRubric = async (req: Request, res: Response) => {
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
};

/**
 * DELETE /api/ai-reviewer/forms/:formId/rubrics/:questionId
 *
 * Remove the rubric for one question. Idempotent (no-op when absent).
 */
export const deleteRubric = async (req: Request, res: Response) => {
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
};
