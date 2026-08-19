import { Request, Response } from 'express';
import rulePackService, { RulePackError } from '../../services/RulePackService';
import { runGoldenEval } from '../../services/AIGoldenEvalRunner';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Rule Pack library + per-form assignment controller.
 *
 * CRUD over the `ai_rule_pack` library plus the per-form assignment
 * (`ai_form_rule_pack_assignment`), backed by `RulePackService`. Extracted
 * verbatim from `ai-reviewer.routes.ts` (second routes-thinning slice, after
 * base-prompts); behavior, status codes, and response shapes are unchanged.
 * The `RulePackError → HTTP` mapping was duplicated inline across the write
 * handlers — it's consolidated here into `handleRulePackError`, mirroring
 * `basePrompts.controller.ts`. These endpoints predate the global `AppError`
 * envelope; migrating them to it is a follow-up, not part of this move.
 */

function handleRulePackError(res: Response, err: unknown, fallback: string, ctx?: Record<string, unknown>): Response {
  if (err instanceof RulePackError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  logger.error(`[AI REVIEWER ROUTE] ${fallback}`, { error: (err as Error).message, ...(ctx ?? {}) });
  return res.status(500).json({ error: fallback });
}

/**
 * GET /api/ai-reviewer/rule-packs
 *
 * Slim pack summaries for the chip picker.
 */
export const listRulePackSummaries = (_req: Request, res: Response) => {
  try {
    const items = rulePackService.listPackSummaries();
    return res.json({ items });
  } catch (err) {
    return handleRulePackError(res, err, 'Failed to list rule packs');
  }
};

/**
 * GET /api/ai-reviewer/rule-packs/all?include_archived=1
 *
 * Full pack rows (including body_md + always_include_urls) for the
 * library page. Different from the `/rule-packs` summary endpoint that
 * only returns the slim shape needed by the chip picker.
 */
export const listAllRulePacks = async (req: Request, res: Response) => {
  const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
  try {
    const items = await rulePackService.listAllPacks(includeArchived);
    return res.json({ items });
  } catch (err) {
    return handleRulePackError(res, err, 'Failed to list rule packs');
  }
};

/**
 * GET /api/ai-reviewer/rule-packs/:id
 *
 * One pack by id, for the editor drawer.
 */
export const getRulePack = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  try {
    const pack = await rulePackService.getPackById(id);
    if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
    return res.json(pack);
  } catch (err) {
    return handleRulePackError(res, err, 'Failed to load rule pack', { id });
  }
};

/**
 * POST /api/ai-reviewer/rule-packs (Admin)
 * Body: { key, name, owner_dept, body_md, always_include_urls }
 *
 * Create a new rule pack. `key` must be unique and slug-safe.
 */
export const createRulePack = async (req: Request, res: Response) => {
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
    return handleRulePackError(res, err, 'Failed to create rule pack');
  }
};

/**
 * PUT /api/ai-reviewer/rule-packs/:id (Admin)
 * Body: { name?, owner_dept?, body_md?, always_include_urls? }
 *
 * Update a pack's content. `key` is immutable post-creation (it's the
 * stable identifier referenced by chip-picker assignments and historic
 * eval-run pack hashes).
 */
export const updateRulePack = async (req: Request, res: Response) => {
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
    return handleRulePackError(res, err, 'Failed to update rule pack', { id });
  }
};

/**
 * DELETE /api/ai-reviewer/rule-packs/:id (Admin)
 *
 * Soft-delete (sets is_archived=true). Form assignments referencing
 * this pack are silently skipped on read until they're re-pointed via
 * the chip picker.
 */
export const deleteRulePack = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const pack = await rulePackService.archivePack(id, userId);
    return res.json(pack);
  } catch (err) {
    return handleRulePackError(res, err, 'Failed to archive rule pack', { id });
  }
};

/**
 * POST /api/ai-reviewer/rule-packs/:id/restore (Admin)
 *
 * Un-archive (clears is_archived). Used when an admin archives by
 * mistake; not exposed as a destructive method to keep the API
 * intent-explicit.
 */
export const restoreRulePack = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  const userId = req.user?.user_id ?? null;
  try {
    const pack = await rulePackService.unarchivePack(id, userId);
    return res.json(pack);
  } catch (err) {
    return handleRulePackError(res, err, 'Failed to restore rule pack', { id });
  }
};

/**
 * GET /api/ai-reviewer/forms/:formId/rule-packs
 *
 * Returns the rule pack keys currently assigned to a form (read from
 * the `ai_form_rule_pack_assignment` table via RulePackService cache).
 */
export const getFormRulePacks = (req: Request, res: Response) => {
  const formId = parsePositiveInt(req.params.formId);
  if (formId === null) {
    return res.status(400).json({ error: 'formId must be a positive integer' });
  }
  try {
    const keys = rulePackService.getPackKeysForForm(formId);
    return res.json({ form_id: formId, keys });
  } catch (err) {
    return handleRulePackError(res, err, 'Failed to read form rule pack assignments', { formId });
  }
};

/**
 * PUT /api/ai-reviewer/forms/:formId/rule-packs (Admin)
 * Body: { keys: string[] }
 *
 * Replaces the rule pack assignment for a form. Validates every key
 * exists in the library before persisting.
 */
export const setFormRulePacks = async (req: Request, res: Response) => {
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
    return handleRulePackError(res, err, 'Failed to update form rule pack assignments', { formId });
  }
};
