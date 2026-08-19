import { Request, Response } from 'express';
import basePromptService, { BasePromptError, type PromptKind } from '../../services/BasePromptService';
import logger from '../../config/logger';
import { parsePositiveInt } from './shared';

/**
 * AI Reviewer — Base Prompt library controller.
 *
 * CRUD + version history / rollback / set-default over the admin-editable
 * Base prompt (and the read-only infrastructure `trace` prompt), backed by
 * `BasePromptService`. Extracted verbatim from `ai-reviewer.routes.ts` as the
 * first step of thinning that oversized route file (routes → controllers);
 * behavior, status codes, and response shapes are unchanged. The
 * `BasePromptError → HTTP` mapping stays local to this domain because these
 * endpoints predate the global `AppError` envelope; migrating them to it is a
 * follow-up, not part of this move.
 */

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
export const listBasePrompts = async (req: Request, res: Response) => {
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
};

/**
 * GET /api/ai-reviewer/base-prompts/:id
 *
 * Full row including the current version body. Used by both the per-form
 * UniversalBaseCard preview and the library editor.
 */
export const getBasePrompt = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  try {
    const base = await basePromptService.getBaseById(id);
    if (!base) return res.status(404).json({ error: 'Base prompt not found' });
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to load base prompt', { id });
  }
};

/**
 * GET /api/ai-reviewer/base-prompts/:id/history?limit=20
 *
 * Version history for the rollback drawer. Newest first.
 */
export const getBasePromptHistory = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const limit = parsePositiveInt(req.query.limit) ?? 20;
  try {
    const items = await basePromptService.getBaseHistory(id, limit);
    return res.json({ items });
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to load base prompt history', { id });
  }
};

/**
 * POST /api/ai-reviewer/base-prompts (Admin)
 * Body: { key, name, description?, prompt_kind, body_md, change_note?, set_as_default? }
 *
 * Create a new base. New rows are NEVER set as default unless the body
 * explicitly opts in via `set_as_default: true` — surprise-default flips
 * would invalidate every form's prompt_hash.
 */
export const createBasePrompt = async (req: Request, res: Response) => {
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
};

/**
 * PUT /api/ai-reviewer/base-prompts/:id (Admin)
 * Body: { name?, description?, body_md, change_note?, set_as_default? }
 *
 * Edit an existing base. ALWAYS creates a new version row — history is
 * forward-only, edits never overwrite. `key` and `prompt_kind` are
 * immutable post-creation (they're stable identifiers downstream).
 */
export const updateBasePrompt = async (req: Request, res: Response) => {
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
};

/**
 * POST /api/ai-reviewer/base-prompts/:id/archive (Admin)
 *
 * Soft-delete. The default base for its kind cannot be archived; flip
 * the default to another base first.
 */
export const archiveBasePrompt = async (req: Request, res: Response) => {
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
};

/**
 * POST /api/ai-reviewer/base-prompts/:id/rollback/:versionId (Admin)
 *
 * Restore an older version's body as a NEW current version. Forward-only
 * history — the original old row is preserved; the new row is a copy of
 * its body with `change_note: "Rollback to v<n>"`.
 */
export const rollbackBasePrompt = async (req: Request, res: Response) => {
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
};

/**
 * POST /api/ai-reviewer/base-prompts/:id/set-default (Admin)
 *
 * Atomically marks this base as THE default for its prompt_kind, clearing
 * the previous default in the same transaction.
 */
export const setDefaultBasePrompt = async (req: Request, res: Response) => {
  const id = parsePositiveInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'id must be a positive integer' });
  const userId = req.user?.user_id ?? null;
  try {
    const base = await basePromptService.setDefaultForKind(id, userId);
    return res.json(base);
  } catch (err) {
    return handleBasePromptError(res, err, 'Failed to set default base prompt', { id });
  }
};
