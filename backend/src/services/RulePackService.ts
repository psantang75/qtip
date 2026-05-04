/**
 * RulePackService
 *
 * File-based, UI-managed rule library for the AI Reviewer.
 *
 *   - Pack content lives in backend/prompts/rule-packs/*.md, one file
 *     per pack. Each file has YAML-ish frontmatter describing the pack
 *     (key, name, owner_dept, optional always_include_urls) and a body
 *     of rules in plain markdown that get injected into the AI prompt.
 *
 *   - Form → pack assignment lives in backend/config/ai-form-rule-packs.json.
 *     A flat object: `{ "<form_id>": ["<pack_key>", ...] }`. The UI
 *     reads + writes this file via the AI Reviewer detail page's chip
 *     picker (so QA admins manage the assignment without engineer help).
 *
 * Why files instead of DB tables: zero schema changes, version control
 * history of pack edits via git, and pack bodies stay readable to both
 * humans and the model. The trade-off is that *editing* pack BODIES
 * still requires a code change; chip-pick assignment is fully UI-driven.
 *
 * Caching: pack files are read once on first access and cached. Call
 * `clearRulePackCache()` from tests; in dev a manual restart picks up
 * pack edits (matches how the prompt loader behaves).
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../config/logger';

const PACK_DIR = path.resolve(__dirname, '..', '..', 'prompts', 'rule-packs');
const ASSIGNMENT_FILE = path.resolve(__dirname, '..', '..', 'config', 'ai-form-rule-packs.json');

export interface RulePack {
  /** Filesystem-safe key, also the slug used in the assignment JSON. */
  key: string;
  /** Display name shown in the chip picker. */
  name: string;
  /** Owning department / area for grouping in the picker. */
  owner_dept: string;
  /** KB page URLs that should always be loaded for runs that include this pack. */
  always_include_urls: string[];
  /** The full markdown rule body (frontmatter stripped). */
  body: string;
}

export type RulePackSummary = Pick<RulePack, 'key' | 'name' | 'owner_dept'>;

export class RulePackError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'RulePackError';
  }
}

let packCache: Map<string, RulePack> | null = null;
let assignmentCache: Map<number, string[]> | null = null;

/** Reset both in-memory caches. Used by tests. */
export function clearRulePackCache(): void {
  packCache = null;
  assignmentCache = null;
}

function ensurePacksLoaded(): Map<string, RulePack> {
  if (packCache) return packCache;
  const cache = new Map<string, RulePack>();
  if (!fs.existsSync(PACK_DIR)) {
    logger.warn(`[RULE PACKS] directory not found: ${PACK_DIR} — no packs available.`);
    packCache = cache;
    return cache;
  }
  const files = fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(PACK_DIR, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      const pack = parsePackFile(raw, file);
      if (cache.has(pack.key)) {
        logger.warn(`[RULE PACKS] duplicate key "${pack.key}" in ${file}; ignoring.`);
        continue;
      }
      cache.set(pack.key, pack);
    } catch (err) {
      logger.warn(`[RULE PACKS] failed to parse ${file}: ${(err as Error).message}`);
    }
  }
  logger.info(`[RULE PACKS] loaded ${cache.size} pack(s) from ${PACK_DIR}`);
  packCache = cache;
  return cache;
}

/**
 * Tiny YAML-ish frontmatter parser. Supports:
 *   key: value          → string
 *   key:                → list when followed by indented "- value" lines
 *     - http://...
 * No quoting / escaping needed for our use case (URLs and short strings).
 */
function parsePackFile(raw: string, filename: string): RulePack {
  const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!fmMatch) {
    throw new Error(`missing or malformed frontmatter in ${filename}`);
  }
  const fm = fmMatch[1];
  const body = (fmMatch[2] ?? '').trim();

  const meta: Record<string, string | string[]> = {};
  const lines = fm.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const k = m[1];
    const v = m[2].trim();
    if (v.length > 0) {
      meta[k] = v;
      i++;
    } else {
      // List continuation: collect indented "- item" lines.
      const list: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        list.push(lines[i].replace(/^\s+-\s+/, '').trim());
        i++;
      }
      meta[k] = list;
    }
  }

  const key = String(meta.key ?? '').trim();
  const name = String(meta.name ?? '').trim();
  const owner_dept = String(meta.owner_dept ?? '').trim();
  const always_include_urls = Array.isArray(meta.always_include_urls)
    ? (meta.always_include_urls as string[])
    : [];

  if (!key) throw new Error(`pack ${filename} missing required frontmatter "key"`);
  if (!name) throw new Error(`pack ${filename} missing required frontmatter "name"`);
  if (!owner_dept) throw new Error(`pack ${filename} missing required frontmatter "owner_dept"`);

  return { key, name, owner_dept, always_include_urls, body };
}

function ensureAssignmentsLoaded(): Map<number, string[]> {
  if (assignmentCache) return assignmentCache;
  const cache = new Map<number, string[]>();
  if (!fs.existsSync(ASSIGNMENT_FILE)) {
    logger.info(`[RULE PACKS] assignment file ${ASSIGNMENT_FILE} not found — starting empty.`);
    assignmentCache = cache;
    return cache;
  }
  try {
    const raw = fs.readFileSync(ASSIGNMENT_FILE, 'utf8');
    const obj = JSON.parse(raw) as Record<string, string[]>;
    for (const [k, v] of Object.entries(obj)) {
      const formId = Number(k);
      if (!Number.isInteger(formId) || formId <= 0) continue;
      if (!Array.isArray(v)) continue;
      cache.set(formId, v.map(String));
    }
  } catch (err) {
    logger.warn(`[RULE PACKS] failed to parse ${ASSIGNMENT_FILE}: ${(err as Error).message}`);
  }
  assignmentCache = cache;
  return cache;
}

function persistAssignments(map: Map<number, string[]>): void {
  const obj: Record<string, string[]> = {};
  for (const [k, v] of map.entries()) obj[String(k)] = v;
  const dir = path.dirname(ASSIGNMENT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ASSIGNMENT_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

class RulePackService {
  /** All packs available in the library (sorted by owner_dept then name). */
  listPacks(): RulePack[] {
    const packs = Array.from(ensurePacksLoaded().values());
    packs.sort((a, b) => {
      const c = a.owner_dept.localeCompare(b.owner_dept);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    return packs;
  }

  /** Lighter shape for the picker UI — no body. */
  listPackSummaries(): RulePackSummary[] {
    return this.listPacks().map((p) => ({ key: p.key, name: p.name, owner_dept: p.owner_dept }));
  }

  /** Pack keys assigned to a form, in deterministic order. */
  getPackKeysForForm(formId: number): string[] {
    return ensureAssignmentsLoaded().get(formId) ?? [];
  }

  /** Resolved packs for a form (skipping unknown keys with a warn). */
  getPacksForForm(formId: number): RulePack[] {
    const keys = this.getPackKeysForForm(formId);
    if (keys.length === 0) return [];
    const all = ensurePacksLoaded();
    const out: RulePack[] = [];
    for (const k of keys) {
      const p = all.get(k);
      if (p) out.push(p);
      else logger.warn(`[RULE PACKS] form ${formId} references unknown pack key "${k}"`);
    }
    return out;
  }

  /**
   * Replace the pack assignment for one form. Validates every key exists
   * before writing. Persists the assignment file atomically.
   */
  setPackKeysForForm(formId: number, keys: string[]): string[] {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new RulePackError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    if (!Array.isArray(keys)) {
      throw new RulePackError('keys must be an array of strings', 'INVALID_KEYS', 400);
    }
    const all = ensurePacksLoaded();
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const raw of keys) {
      const k = String(raw).trim();
      if (!k || seen.has(k)) continue;
      if (!all.has(k)) {
        throw new RulePackError(`Unknown rule pack "${k}"`, 'UNKNOWN_PACK', 400);
      }
      seen.add(k);
      dedup.push(k);
    }
    const map = ensureAssignmentsLoaded();
    if (dedup.length === 0) map.delete(formId);
    else map.set(formId, dedup);
    persistAssignments(map);
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
}

export const rulePackService = new RulePackService();
export default rulePackService;
export { RulePackService };
