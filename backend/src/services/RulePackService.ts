/**
 * RulePackService
 *
 * DB-backed library of rule packs + per-form pack assignments.
 *
 * Rule packs are reusable bodies of policy/process text injected into
 * the AI Reviewer system prompt for any form they're assigned to (see
 * `renderPacksForPrompt` callers in `AIReviewerService` and the prompt
 * builders). Form admins pick which packs apply to their form via the
 * chip picker on the AI Reviewer Form Detail page; department leads
 * author the pack bodies in the Rule Pack Library page.
 *
 * Source of truth: three tables (added in 20260513100000):
 *   - ai_rule_pack
 *   - ai_form_rule_pack_assignment
 *
 * Caching strategy (sync public API, async writes):
 *   - Reads are sync and served from in-process caches because all
 *     existing call sites — including the synchronous prompt builders
 *     in `aiReviewerTwoPassPrompts` and `aiReviewerPrompt` — were sync
 *     when this service was file-based. Keeping the read API sync means
 *     zero churn at the 8 existing call sites.
 *   - `warmCache()` is awaited at server bootstrap before `app.listen`
 *     so the first request never sees an unloaded cache.
 *   - Every write (`setPackKeysForForm`, `upsertPack`, `archivePack`)
 *     refreshes the cache immediately on the writer instance.
 *   - A 60s background refresh handles staleness across multiple
 *     backend instances (one writes, the others pick up within a minute).
 *   - `clearRulePackCache()` is exposed for tests.
 *
 * The bootstrap-then-cache pattern matches how config tables of this
 * size + edit cadence (a handful of packs, edited weekly at most) are
 * idiomatically served in this codebase.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';

const REFRESH_INTERVAL_MS = 60_000;

export interface RulePack {
  /** Numeric DB id, used by admin endpoints. */
  id: number;
  /** Stable slug; the public identifier referenced by chip picker + eval-run pack hashes. */
  key: string;
  /** Display name shown in the chip picker. */
  name: string;
  /** Owning department / area for grouping in the picker. */
  owner_dept: string;
  /** KB page URLs that should always be loaded for runs that include this pack. */
  always_include_urls: string[];
  /** The full markdown rule body. */
  body: string;
  /** Soft-delete flag — archived packs are hidden from active reads but still resolvable for historical eval runs. */
  is_archived: boolean;
  /** Last-modified timestamp, surfaced in the library UI. */
  updated_at: Date;
}

export type RulePackSummary = Pick<RulePack, 'key' | 'name' | 'owner_dept'>;

export interface UpsertRulePackInput {
  key: string;
  name: string;
  owner_dept: string;
  body_md: string;
  always_include_urls: string[];
  updated_by?: number | null;
}

export class RulePackError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'RulePackError';
  }
}

let packCache: Map<string, RulePack> | null = null;
/** form_id → ordered list of pack KEYS assigned to it */
let assignmentCache: Map<number, string[]> | null = null;
let cacheLoadedAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;

/** Reset both in-memory caches and stop the background refresh timer. Used by tests. */
export function clearRulePackCache(): void {
  packCache = null;
  assignmentCache = null;
  cacheLoadedAt = 0;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function rowToRulePack(row: {
  id: number;
  key: string;
  name: string;
  owner_dept: string;
  body_md: string;
  always_include_urls_json: unknown;
  is_archived: boolean;
  updated_at: Date;
}): RulePack {
  let urls: string[] = [];
  if (Array.isArray(row.always_include_urls_json)) {
    urls = (row.always_include_urls_json as unknown[])
      .map((u) => String(u))
      .filter((u) => u.length > 0);
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    owner_dept: row.owner_dept,
    always_include_urls: urls,
    body: row.body_md,
    is_archived: row.is_archived,
    updated_at: row.updated_at,
  };
}

async function refreshCache(): Promise<void> {
  const [packRows, assignmentRows] = await Promise.all([
    prisma.aiRulePack.findMany({ where: { is_archived: false } }),
    prisma.aiFormRulePackAssignment.findMany({
      include: { rule_pack: true },
      orderBy: [{ form_id: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const newPackCache = new Map<string, RulePack>();
  for (const row of packRows) {
    const pack = rowToRulePack(row as any);
    if (newPackCache.has(pack.key)) {
      logger.warn(`[RULE PACKS] duplicate active key "${pack.key}" in DB; ignoring duplicate id=${pack.id}`);
      continue;
    }
    newPackCache.set(pack.key, pack);
  }

  const newAssignmentCache = new Map<number, string[]>();
  for (const row of assignmentRows) {
    const pack = (row as any).rule_pack as { key: string; is_archived: boolean } | null;
    if (!pack || pack.is_archived) continue; // skip orphaned/archived
    const list = newAssignmentCache.get(row.form_id) ?? [];
    if (!list.includes(pack.key)) list.push(pack.key);
    newAssignmentCache.set(row.form_id, list);
  }

  packCache = newPackCache;
  assignmentCache = newAssignmentCache;
  cacheLoadedAt = Date.now();
}

/**
 * Hydrate the cache and start the background refresh timer. Call once
 * during server bootstrap before `app.listen`. Errors propagate so a
 * failing DB doesn't silently start the server with an empty cache.
 */
export async function warmCache(): Promise<void> {
  await refreshCache();
  logger.info(`[RULE PACKS] cache warmed: ${packCache?.size ?? 0} pack(s), ${assignmentCache?.size ?? 0} form assignment(s)`);
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      refreshCache().catch((err) => {
        logger.warn(`[RULE PACKS] background refresh failed: ${(err as Error).message}`);
      });
    }, REFRESH_INTERVAL_MS);
    // Don't keep the event loop alive just for this timer (tests, scripts).
    if (refreshTimer.unref) refreshTimer.unref();
  }
}

function ensureCacheLoaded(): { packs: Map<string, RulePack>; assignments: Map<number, string[]> } {
  if (!packCache || !assignmentCache) {
    // First-call fallback: an empty result is safer than throwing
    // because reads are on the AI Reviewer hot path and the prompt
    // builder gracefully omits the RULE PACKS section when empty.
    // The bootstrap caller is expected to await `warmCache()` so this
    // branch is exceptional in production.
    logger.warn('[RULE PACKS] cache not warmed yet — returning empty until next refresh');
    return { packs: new Map(), assignments: new Map() };
  }
  return { packs: packCache, assignments: assignmentCache };
}

class RulePackService {
  /** All active packs, sorted by owner_dept then name. */
  listPacks(): RulePack[] {
    const { packs } = ensureCacheLoaded();
    const out = Array.from(packs.values());
    out.sort((a, b) => {
      const c = a.owner_dept.localeCompare(b.owner_dept);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    return out;
  }

  /** Lighter shape for the chip picker — no body. */
  listPackSummaries(): RulePackSummary[] {
    return this.listPacks().map((p) => ({ key: p.key, name: p.name, owner_dept: p.owner_dept }));
  }

  /** Pack keys assigned to a form, in deterministic order. */
  getPackKeysForForm(formId: number): string[] {
    const { assignments } = ensureCacheLoaded();
    return assignments.get(formId) ?? [];
  }

  /** Resolved active packs for a form (silently skips unknown / archived keys). */
  getPacksForForm(formId: number): RulePack[] {
    const { packs } = ensureCacheLoaded();
    const keys = this.getPackKeysForForm(formId);
    if (keys.length === 0) return [];
    const out: RulePack[] = [];
    for (const k of keys) {
      const p = packs.get(k);
      if (p) out.push(p);
      else logger.warn(`[RULE PACKS] form ${formId} references unknown / archived pack key "${k}"`);
    }
    return out;
  }

  /**
   * Replace the pack assignment for one form. Validates every key
   * exists (and is not archived) before writing, then refreshes cache.
   */
  async setPackKeysForForm(formId: number, keys: string[], updatedBy?: number | null): Promise<string[]> {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new RulePackError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    if (!Array.isArray(keys)) {
      throw new RulePackError('keys must be an array of strings', 'INVALID_KEYS', 400);
    }
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const raw of keys) {
      const k = String(raw ?? '').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      dedup.push(k);
    }

    // Resolve key → pack id from the live DB (not the cache) so we
    // don't reject a key that was just created on another instance.
    const resolved = dedup.length === 0
      ? []
      : await prisma.aiRulePack.findMany({
          where: { key: { in: dedup }, is_archived: false },
          select: { id: true, key: true },
        });
    const byKey = new Map(resolved.map((r) => [r.key, r.id]));
    for (const k of dedup) {
      if (!byKey.has(k)) {
        throw new RulePackError(`Unknown rule pack "${k}"`, 'UNKNOWN_PACK', 400);
      }
    }

    await prisma.$transaction([
      prisma.aiFormRulePackAssignment.deleteMany({ where: { form_id: formId } }),
      ...(dedup.length > 0
        ? [
            prisma.aiFormRulePackAssignment.createMany({
              data: dedup.map((k, i) => ({
                form_id: formId,
                rule_pack_id: byKey.get(k)!,
                sort_order: i,
                updated_by: updatedBy ?? null,
              })),
            }),
          ]
        : []),
    ]);

    await refreshCache();
    logger.info(`[RULE PACKS] form ${formId} now uses [${dedup.join(', ')}]`);
    return dedup;
  }

  /** Always-include KB URLs sourced from every pack assigned to the form. */
  getAlwaysIncludeUrlsForForm(formId: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const pack of this.getPacksForForm(formId)) {
      for (const url of pack.always_include_urls) {
        if (!seen.has(url)) {
          seen.add(url);
          out.push(url);
        }
      }
    }
    return out;
  }

  /**
   * Render selected packs as a single block of system-prompt text. Each
   * pack becomes a labeled section so the model can attribute rules to
   * the right source.
   */
  renderPacksForPrompt(formId: number): string {
    const packs = this.getPacksForForm(formId);
    if (packs.length === 0) return '';
    const parts: string[] = [];
    for (const p of packs) {
      parts.push(`RULE PACK: ${p.name} (owner: ${p.owner_dept})\n${p.body.trim()}`);
    }
    return '\n\n' + parts.join('\n\n');
  }

  // ── Admin write API (used by the Rule Pack Library page) ────────────

  /** Get a single pack by id, including archived ones, for the editor. */
  async getPackById(id: number): Promise<RulePack | null> {
    if (!Number.isInteger(id) || id <= 0) return null;
    const row = await prisma.aiRulePack.findUnique({ where: { id } });
    return row ? rowToRulePack(row as any) : null;
  }

  /** List all packs including archived (for the library page filter). */
  async listAllPacks(includeArchived = false): Promise<RulePack[]> {
    const rows = await prisma.aiRulePack.findMany({
      where: includeArchived ? {} : { is_archived: false },
      orderBy: [{ owner_dept: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => rowToRulePack(r as any));
  }

  /**
   * Create or update a pack (keyed on `key`). Used by the library editor.
   * Refreshes cache so the new content is immediately visible to readers.
   */
  async upsertPack(input: UpsertRulePackInput): Promise<RulePack> {
    const key = String(input.key ?? '').trim();
    const name = String(input.name ?? '').trim();
    const owner_dept = String(input.owner_dept ?? '').trim();
    const body_md = String(input.body_md ?? '');
    const urls = Array.isArray(input.always_include_urls)
      ? input.always_include_urls.map((u) => String(u).trim()).filter((u) => u.length > 0)
      : [];

    if (!key) throw new RulePackError('key is required', 'INVALID_KEY', 400);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
      throw new RulePackError(
        'key must be lowercase alphanumeric with dashes (e.g. "tech-ticket-process")',
        'INVALID_KEY',
        400,
      );
    }
    if (!name) throw new RulePackError('name is required', 'INVALID_NAME', 400);
    if (!owner_dept) throw new RulePackError('owner_dept is required', 'INVALID_OWNER_DEPT', 400);
    if (!body_md.trim()) throw new RulePackError('body_md is required', 'INVALID_BODY', 400);

    const row = await prisma.aiRulePack.upsert({
      where: { key },
      update: {
        name,
        owner_dept,
        body_md,
        always_include_urls_json: urls,
        updated_by: input.updated_by ?? null,
      },
      create: {
        key,
        name,
        owner_dept,
        body_md,
        always_include_urls_json: urls,
        updated_by: input.updated_by ?? null,
      },
    });

    await refreshCache();
    return rowToRulePack(row as any);
  }

  /** Soft-delete a pack. Existing form assignments are auto-removed from active reads via the cache filter. */
  async archivePack(id: number, updatedBy?: number | null): Promise<RulePack | null> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new RulePackError('Invalid pack id', 'INVALID_PACK_ID', 400);
    }
    const row = await prisma.aiRulePack.update({
      where: { id },
      data: { is_archived: true, updated_by: updatedBy ?? null },
    });
    await refreshCache();
    return rowToRulePack(row as any);
  }

  /** Un-archive (used if an admin archives by mistake). */
  async unarchivePack(id: number, updatedBy?: number | null): Promise<RulePack | null> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new RulePackError('Invalid pack id', 'INVALID_PACK_ID', 400);
    }
    const row = await prisma.aiRulePack.update({
      where: { id },
      data: { is_archived: false, updated_by: updatedBy ?? null },
    });
    await refreshCache();
    return rowToRulePack(row as any);
  }
}

export const rulePackService = new RulePackService();
export default rulePackService;
export { RulePackService };
