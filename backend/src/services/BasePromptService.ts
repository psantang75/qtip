/**
 * BasePromptService
 *
 * DB-backed library of universal Base prompts the AI Reviewer
 * concatenates with rule packs + per-form guidance + learned corrections
 * at run time. Layer 1 of the 4-layer system-prompt model.
 *
 * Source of truth: two tables (added in 20260515080000):
 *   - ai_base_prompt          parent row per logical base
 *   - ai_base_prompt_version  immutable history rows
 *
 * Default rows for both `prompt_kind = 'base'` (key `base.v1`) and
 * `prompt_kind = 'trace'` (key `trace.v1`) are seeded by the data
 * migration `20260526150000_seed_default_base_prompts` — there is no
 * runtime fallback to disk. Fresh environments get the rows on
 * `prisma migrate deploy`; existing environments are untouched (the
 * migration is idempotent).
 *
 * Two prompt kinds are stored:
 *   - 'base'   — the ONE admin-editable universal Base prompt. The same
 *                body is used by both the single-source pipeline AND the
 *                multi-source synthesis pipeline; pass-specific
 *                scaffolding (input shape, output schema, cross-source
 *                rules) is appended in code via
 *                `aiReviewerPromptAddenda.ts`. There is exactly ONE
 *                non-archived row of this kind, marked is_default=1.
 *   - 'trace'  — INFRASTRUCTURE prompt for Pass 1 of the two-pass
 *                pipeline. Hidden from the Library page; edited by AI
 *                engineers via PR or DB. Admins never see it.
 *
 * The previous 'single_source' / 'synthesis' kinds were retired in
 * migration 20260515090000 (rows kept as soft-archived rows so historical
 * eval-run prompt_hash references remain resolvable).
 *
 * Caching strategy (sync public read API, async writes):
 *   - Reads are sync and served from in-process caches. The AI Reviewer
 *     prompt builders (`buildAiReviewerPrompt`, `buildTracePrompt`,
 *     `buildSynthesisPrompt`) need sync access; the cache keeps the
 *     read API sync at zero churn for those call sites.
 *   - `warmCache()` is awaited at server bootstrap before `app.listen`.
 *   - Every write (`upsertBase`, `archiveBase`, `rollbackToVersion`,
 *     `setDefaultForKind`) refreshes the cache immediately on the
 *     writer instance.
 *   - A 60s background refresh handles staleness across multiple
 *     backend instances (one writes, the others pick up within a minute).
 *   - `clearBasePromptCache()` is exposed for tests.
 *
 * Mirrors `RulePackService` exactly so the two prompt-content services
 * read identically at the call sites.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';
import { addendumForKind } from './aiReviewerPromptAddenda';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Storage-level prompt kinds. Only `'base'` and `'trace'` are valid going
 * forward; the legacy `'single_source'` / `'synthesis'` values exist on
 * archived rows from before migration 20260515090000 and are not
 * issuable for new rows.
 */
export type PromptKind = 'base' | 'trace';

/**
 * Pass-level discriminator used by `getAssembledPrompt`. Both pipelines
 * resolve to the same `'base'` row in storage; the discriminator only
 * controls which addendum is appended (input shape + output schema).
 */
/**
 * Runtime pass kinds that the assembler supports. The first two are
 * the legacy monolithic passes; the second two are the chunked
 * synthesis pipeline used on large forms (>30 questions) where a
 * single Opus call would saturate the wall-clock budget.
 */
export type AssembledPromptKind =
  | 'single_source'
  | 'synthesis'
  | 'reasoning'
  | 'answers_chunk';

export interface BasePromptSummary {
  id: number;
  key: string;
  name: string;
  prompt_kind: PromptKind;
  is_default: boolean;
  is_archived: boolean;
  current_version: number | null;
  updated_at: Date;
}

export interface BasePromptDetail extends BasePromptSummary {
  description: string | null;
  body: string;
}

export interface BasePromptVersionRow {
  id: number;
  base_prompt_id: number;
  version: number;
  body_md: string;
  change_note: string | null;
  created_by: number | null;
  created_at: Date;
}

export interface UpsertBasePromptInput {
  /** Numeric id when editing an existing base; omit for create. */
  id?: number;
  key: string;
  name: string;
  description?: string | null;
  prompt_kind: PromptKind;
  body_md: string;
  /** Free-text "what changed" message recorded on the new version row. */
  change_note?: string | null;
  /** Setting true on save flips the default pointer for this kind atomically. */
  set_as_default?: boolean;
  updated_by?: number | null;
}

/** Internal cache row — what `getBaseForKind` returns as a typed result. */
export interface BaseResolution {
  id: number;
  key: string;
  version: number;
  body: string;
}

export class BasePromptError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'BasePromptError';
  }
}

/**
 * Kinds that admins are allowed to author through the UI / API. Trace
 * is editable by infrastructure engineers but not surfaced in the
 * Library, and the legacy single_source / synthesis kinds are no longer
 * issuable for new rows.
 */
const VALID_KINDS: ReadonlySet<PromptKind> = new Set(['base', 'trace']);

// ── In-memory cache ────────────────────────────────────────────────────

/** id → resolved active body for fast lookups. */
let baseCacheById: Map<number, BaseResolution> | null = null;
/** prompt_kind → id of the non-archived row marked is_default for that kind. */
let defaultsByKind: Map<PromptKind, number> | null = null;
let cacheLoadedAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;

export function clearBasePromptCache(): void {
  baseCacheById = null;
  defaultsByKind = null;
  cacheLoadedAt = 0;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function refreshCache(): Promise<void> {
  const baseRows = await prisma.aiBasePrompt.findMany({
    where: { is_archived: false },
    include: { current_version: true },
  });

  const newBaseCache = new Map<number, BaseResolution>();
  const newDefaults = new Map<PromptKind, number>();
  for (const row of baseRows) {
    if (!row.current_version) {
      logger.warn(`[BASE PROMPTS] base id=${row.id} key="${row.key}" has no current_version_id; skipping`);
      continue;
    }
    // Skip rows whose kind isn't valid going forward (legacy
    // single_source / synthesis archived rows would have been filtered
    // by is_archived above, but we double-check here in case any legacy
    // row lost its archived flag).
    const kind = row.prompt_kind;
    if (kind !== 'base' && kind !== 'trace') {
      logger.warn(`[BASE PROMPTS] base id=${row.id} key="${row.key}" has legacy kind="${kind}"; ignoring`);
      continue;
    }
    newBaseCache.set(row.id, {
      id: row.id,
      key: row.key,
      version: row.current_version.version,
      body: row.current_version.body_md,
    });
    if (row.is_default) {
      const k = kind as PromptKind;
      if (newDefaults.has(k)) {
        logger.warn(`[BASE PROMPTS] multiple defaults for kind="${k}"; keeping first id=${newDefaults.get(k)}`);
      } else {
        newDefaults.set(k, row.id);
      }
    }
  }

  baseCacheById = newBaseCache;
  defaultsByKind = newDefaults;
  cacheLoadedAt = Date.now();
}

/**
 * Hydrate the cache and start the background refresh timer. Call once
 * during server bootstrap before `app.listen`. Errors propagate so a
 * failing DB doesn't silently start the server with an empty cache.
 *
 * Default rows for `base.v1` and `trace.v1` are inserted by the data
 * migration `20260526150000_seed_default_base_prompts` and not by this
 * service — `prisma migrate deploy` is the only seed path.
 */
export async function warmCache(): Promise<void> {
  await refreshCache();
  logger.info(
    `[BASE PROMPTS] cache warmed: ${baseCacheById?.size ?? 0} base(s), ` +
      `${defaultsByKind?.size ?? 0} default(s)`,
  );
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      refreshCache().catch((err) => {
        logger.warn(`[BASE PROMPTS] background refresh failed: ${(err as Error).message}`);
      });
    }, REFRESH_INTERVAL_MS);
    if (refreshTimer.unref) refreshTimer.unref();
  }
}

function ensureCacheLoaded(): {
  bases: Map<number, BaseResolution>;
  defaults: Map<PromptKind, number>;
} {
  if (!baseCacheById || !defaultsByKind) {
    logger.warn('[BASE PROMPTS] cache not warmed yet — returning empty until next refresh');
    return { bases: new Map(), defaults: new Map() };
  }
  return { bases: baseCacheById, defaults: defaultsByKind };
}

class BasePromptService {
  /**
   * Resolve the active prompt body for a kind. The optional
   * `baseIdOverride` honors a per-form selection (`forms.ai_base_prompt_id`):
   * when supplied and resolvable in the cache it wins, otherwise we fall
   * back to the kind's global default. Throws when no default is
   * configured (a hard config error — the seed bootstrap guarantees this
   * can't happen on a properly-warmed instance).
   */
  getBaseForKind(kind: PromptKind, baseIdOverride?: number | null): BaseResolution {
    const { bases, defaults } = ensureCacheLoaded();

    if (baseIdOverride != null && Number.isInteger(baseIdOverride) && baseIdOverride > 0) {
      const override = bases.get(baseIdOverride);
      if (override) return override;
      // Silent fall-through to default — the override may point at an
      // archived row; we don't want a per-form misconfiguration to
      // hard-fail every AI run on that form.
      logger.warn(
        `[BASE PROMPTS] override id=${baseIdOverride} not in cache (archived or stale) — falling back to default for kind "${kind}"`,
      );
    }

    const defaultId = defaults.get(kind);
    if (defaultId == null) {
      throw new BasePromptError(`No default base prompt configured for kind "${kind}"`, 'NO_DEFAULT', 500);
    }
    const def = bases.get(defaultId);
    if (!def) {
      throw new BasePromptError(
        `Default base id=${defaultId} for kind "${kind}" is missing from cache`,
        'NO_DEFAULT',
        500,
      );
    }
    return def;
  }

  /**
   * Build the assembled system prompt for a runtime pipeline pass:
   * the universal Base body (`kind = 'base'`) concatenated with the
   * pass-specific addendum (input shape + output schema + cross-source
   * rules) from `aiReviewerPromptAddenda.ts`.
   *
   * `kind` is the PASS, not the storage kind:
   *   - 'single_source' — one-LLM-call pipeline (1 source attached)
   *   - 'synthesis'     — Pass 2 of the legacy two-pass pipeline
   *   - 'reasoning'     — Pass 2A of the chunked synthesis pipeline
   *                       (Opus emits reasoning artefacts, no answers)
   *   - 'answers_chunk' — Pass 2B of the chunked synthesis pipeline
   *                       (Sonnet emits answers for one form category)
   *
   * Pass 1 (trace) is a separate prompt — call
   * `getBaseForKind('trace')` directly for that.
   *
   * `baseIdOverride` (optional) honors a per-form base prompt selection
   * — see `getBaseForKind` for fall-through semantics.
   */
  getAssembledPrompt(
    kind: AssembledPromptKind,
    baseIdOverride?: number | null,
  ): { id: number; key: string; version: number; body: string } {
    const base = this.getBaseForKind('base', baseIdOverride);
    return {
      id: base.id,
      key: base.key,
      version: base.version,
      body: base.body + addendumForKind(kind),
    };
  }

  // ── Library reads ──────────────────────────────────────────────────

  async listBases(opts?: { kind?: PromptKind; includeArchived?: boolean }): Promise<BasePromptSummary[]> {
    const where: any = {};
    if (opts?.kind) where.prompt_kind = opts.kind;
    if (!opts?.includeArchived) where.is_archived = false;
    const rows = await prisma.aiBasePrompt.findMany({
      where,
      include: { current_version: true },
      orderBy: [{ prompt_kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      prompt_kind: r.prompt_kind as PromptKind,
      is_default: r.is_default,
      is_archived: r.is_archived,
      current_version: r.current_version?.version ?? null,
      updated_at: r.updated_at,
    }));
  }

  async getBaseById(id: number): Promise<BasePromptDetail | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    const row = await prisma.aiBasePrompt.findUnique({
      where: { id },
      include: { current_version: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      prompt_kind: row.prompt_kind as PromptKind,
      is_default: row.is_default,
      is_archived: row.is_archived,
      current_version: row.current_version?.version ?? null,
      updated_at: row.updated_at,
      body: row.current_version?.body_md ?? '',
    };
  }

  async getBaseHistory(id: number, limit = 20): Promise<BasePromptVersionRow[]> {
    if (!Number.isInteger(id) || id <= 0) return [];
    const cap = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = await prisma.aiBasePromptVersion.findMany({
      where: { base_prompt_id: id },
      orderBy: { version: 'desc' },
      take: cap,
    });
    return rows.map((r) => ({
      id: r.id,
      base_prompt_id: r.base_prompt_id,
      version: r.version,
      body_md: r.body_md,
      change_note: r.change_note,
      created_by: r.created_by,
      created_at: r.created_at,
    }));
  }

  // ── Library writes (Admin-only) ────────────────────────────────────

  /**
   * Create a new base or edit an existing one. Edits ALWAYS create a new
   * version row (history is forward-only). The parent row's
   * `current_version_id` is updated to point at the new version atomically.
   */
  async upsertBase(input: UpsertBasePromptInput): Promise<BasePromptDetail> {
    const key = String(input.key ?? '').trim();
    const name = String(input.name ?? '').trim();
    const description = input.description == null ? null : String(input.description).trim();
    const promptKind = input.prompt_kind;
    const body = String(input.body_md ?? '');
    const changeNote = input.change_note == null ? null : String(input.change_note).slice(0, 500);

    if (!key) throw new BasePromptError('key is required', 'INVALID_KEY', 400);
    if (!/^[a-z0-9][a-z0-9.\-_]*$/.test(key)) {
      throw new BasePromptError(
        'key must be lowercase alphanumeric with dashes/dots/underscores (e.g. "system.v3", "sales-discovery.v1")',
        'INVALID_KEY',
        400,
      );
    }
    if (!name) throw new BasePromptError('name is required', 'INVALID_NAME', 400);
    if (!VALID_KINDS.has(promptKind)) {
      throw new BasePromptError('prompt_kind must be one of base | trace', 'INVALID_KIND', 400);
    }
    if (!body.trim()) throw new BasePromptError('body_md is required', 'INVALID_BODY', 400);

    const result = await prisma.$transaction(async (tx) => {
      // Find the existing parent — by id if provided, otherwise by key.
      let parent = input.id
        ? await tx.aiBasePrompt.findUnique({ where: { id: input.id } })
        : await tx.aiBasePrompt.findUnique({ where: { key } });

      // If user passed an id but the parent doesn't exist that's a bug,
      // not a fall-through to create — fail loudly.
      if (input.id && !parent) {
        throw new BasePromptError(`Base prompt id=${input.id} not found`, 'NOT_FOUND', 404);
      }

      // Disallow changing prompt_kind on existing rows — would break the
      // builder that consumes that base.
      if (parent && parent.prompt_kind !== promptKind) {
        throw new BasePromptError(
          `Cannot change prompt_kind from "${parent.prompt_kind}" to "${promptKind}" on an existing base`,
          'KIND_LOCKED',
          400,
        );
      }

      if (!parent) {
        parent = await tx.aiBasePrompt.create({
          data: {
            key,
            name,
            description,
            prompt_kind: promptKind,
            is_default: false,
            is_archived: false,
            updated_by: input.updated_by ?? null,
          },
        });
      } else {
        // Editing — refresh metadata fields too.
        await tx.aiBasePrompt.update({
          where: { id: parent.id },
          data: {
            name,
            description,
            updated_by: input.updated_by ?? null,
          },
        });
      }

      // Compute next version number atomically inside the transaction.
      const lastVersion = await tx.aiBasePromptVersion.findFirst({
        where: { base_prompt_id: parent.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      const versionRow = await tx.aiBasePromptVersion.create({
        data: {
          base_prompt_id: parent.id,
          version: nextVersion,
          body_md: body,
          change_note: changeNote,
          created_by: input.updated_by ?? null,
        },
      });

      const updated = await tx.aiBasePrompt.update({
        where: { id: parent.id },
        data: { current_version_id: versionRow.id },
        include: { current_version: true },
      });

      // Optional default flip — done inside the same transaction so the
      // cache never sees two defaults for one kind.
      if (input.set_as_default) {
        await tx.aiBasePrompt.updateMany({
          where: { prompt_kind: promptKind, NOT: { id: parent.id } },
          data: { is_default: false },
        });
        await tx.aiBasePrompt.update({
          where: { id: parent.id },
          data: { is_default: true },
        });
        return await tx.aiBasePrompt.findUnique({
          where: { id: parent.id },
          include: { current_version: true },
        });
      }

      return updated;
    });

    if (!result) throw new BasePromptError('Upsert returned no row', 'UPSERT_FAILED', 500);

    await refreshCache();
    logger.info(`[BASE PROMPTS] upserted "${result.key}" → v${result.current_version?.version ?? '?'}`);

    return {
      id: result.id,
      key: result.key,
      name: result.name,
      description: result.description,
      prompt_kind: result.prompt_kind as PromptKind,
      is_default: result.is_default,
      is_archived: result.is_archived,
      current_version: result.current_version?.version ?? null,
      updated_at: result.updated_at,
      body: result.current_version?.body_md ?? '',
    };
  }

  /**
   * Soft-delete a base. Forms still pointing at it will fall back to
   * the default for their kind (the FK on forms is ON DELETE SET NULL,
   * but archive doesn't trigger that — the cache filter does the work).
   * Refuses to archive a base that is currently the default for its
   * kind; flip the default to another base first.
   */
  async archiveBase(id: number, updatedBy?: number | null): Promise<BasePromptDetail | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    const existing = await prisma.aiBasePrompt.findUnique({ where: { id } });
    if (!existing) return null;
    if (existing.is_default) {
      throw new BasePromptError(
        'Cannot archive the default base for its kind. Set another base as default first.',
        'IS_DEFAULT',
        400,
      );
    }
    await prisma.aiBasePrompt.update({
      where: { id },
      data: { is_archived: true, updated_by: updatedBy ?? null },
    });
    await refreshCache();
    logger.info(`[BASE PROMPTS] archived id=${id} key="${existing.key}"`);
    return this.getBaseById(id);
  }

  /**
   * Restore an older version's body as the new current version. Creates
   * a NEW version row (with body copied from the source version), so the
   * timeline reads forward-only and never erases history.
   */
  async rollbackToVersion(baseId: number, versionId: number, userId?: number | null): Promise<BasePromptDetail> {
    if (!Number.isInteger(baseId) || baseId <= 0) {
      throw new BasePromptError('Invalid base id', 'INVALID_ID', 400);
    }
    if (!Number.isInteger(versionId) || versionId <= 0) {
      throw new BasePromptError('Invalid version id', 'INVALID_VERSION_ID', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.aiBasePromptVersion.findUnique({ where: { id: versionId } });
      if (!source || source.base_prompt_id !== baseId) {
        throw new BasePromptError('Version not found for this base', 'VERSION_NOT_FOUND', 404);
      }
      const lastVersion = await tx.aiBasePromptVersion.findFirst({
        where: { base_prompt_id: baseId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;
      const newRow = await tx.aiBasePromptVersion.create({
        data: {
          base_prompt_id: baseId,
          version: nextVersion,
          body_md: source.body_md,
          change_note: `Rollback to v${source.version}`,
          created_by: userId ?? null,
        },
      });
      await tx.aiBasePrompt.update({
        where: { id: baseId },
        data: { current_version_id: newRow.id, updated_by: userId ?? null },
      });
      return await tx.aiBasePrompt.findUnique({
        where: { id: baseId },
        include: { current_version: true },
      });
    });

    if (!result) throw new BasePromptError('Rollback returned no row', 'ROLLBACK_FAILED', 500);

    await refreshCache();
    logger.info(`[BASE PROMPTS] rolled back id=${baseId} → new v${result.current_version?.version ?? '?'}`);

    return {
      id: result.id,
      key: result.key,
      name: result.name,
      description: result.description,
      prompt_kind: result.prompt_kind as PromptKind,
      is_default: result.is_default,
      is_archived: result.is_archived,
      current_version: result.current_version?.version ?? null,
      updated_at: result.updated_at,
      body: result.current_version?.body_md ?? '',
    };
  }

  /**
   * Set this base as THE default for its prompt_kind. Atomically clears
   * the previous default in the same transaction so the cache never sees
   * two defaults at once.
   */
  async setDefaultForKind(baseId: number, userId?: number | null): Promise<BasePromptDetail> {
    if (!Number.isInteger(baseId) || baseId <= 0) {
      throw new BasePromptError('Invalid base id', 'INVALID_ID', 400);
    }
    const target = await prisma.aiBasePrompt.findUnique({ where: { id: baseId } });
    if (!target) throw new BasePromptError('Base not found', 'NOT_FOUND', 404);
    if (target.is_archived) {
      throw new BasePromptError('Cannot set an archived base as default', 'IS_ARCHIVED', 400);
    }
    await prisma.$transaction([
      prisma.aiBasePrompt.updateMany({
        where: { prompt_kind: target.prompt_kind, NOT: { id: baseId } },
        data: { is_default: false },
      }),
      prisma.aiBasePrompt.update({
        where: { id: baseId },
        data: { is_default: true, updated_by: userId ?? null },
      }),
    ]);
    await refreshCache();
    logger.info(`[BASE PROMPTS] set default for kind="${target.prompt_kind}" → id=${baseId} key="${target.key}"`);
    const detail = await this.getBaseById(baseId);
    if (!detail) throw new BasePromptError('Default flip returned no row', 'NOT_FOUND', 500);
    return detail;
  }

  // Per-form base assignment was removed in migration 20260515090000:
  // "universal" with a per-form override is a contradiction. Every form
  // now uses the single default base for its kind.
}

export const basePromptService = new BasePromptService();
export default basePromptService;
