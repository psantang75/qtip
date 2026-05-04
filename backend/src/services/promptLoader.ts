/**
 * Lightweight prompt loader.
 *
 * Reads versioned prompt templates from backend/prompts/<name>.md and
 * performs `{{key}}` interpolation. Templates are read once and cached
 * by name (process-lifetime cache) — prompt files are immutable in
 * production, so re-reading on every LLM call wastes I/O.
 *
 * Why a 30-line custom interpolator instead of Handlebars: prompts are
 * pure text-fill, no helpers, no partials, no logic. Pulling Handlebars
 * for `{{key}}` substitution is overkill and would obscure the byte
 * equivalence we need to prove in Phase 2 of the maturity rollout.
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../config/logger';

const PROMPT_ROOT = path.resolve(__dirname, '..', '..', 'prompts');
const fileCache = new Map<string, string>();

/** Where prompts live on disk, exposed for tests + diagnostics. */
export function getPromptRoot(): string {
  return PROMPT_ROOT;
}

/** Reset the in-memory file cache. Tests use this to pick up edits. */
export function clearPromptCache(): void {
  fileCache.clear();
}

/** Resolve a logical prompt name (e.g. 'ai-reviewer/system.v1') to its absolute file path. */
function resolvePromptPath(name: string): string {
  if (name.includes('..')) {
    throw new Error(`Invalid prompt name "${name}" — path traversal not allowed.`);
  }
  return path.join(PROMPT_ROOT, `${name}.md`);
}

/**
 * Load and interpolate a prompt template.
 *
 * Trailing newlines on the file are stripped (editors love to add them
 * silently and a stray \n would break byte equivalence with the legacy
 * inline strings). Internal whitespace is preserved exactly.
 */
export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  let template = fileCache.get(name);
  if (template === undefined) {
    const file = resolvePromptPath(name);
    template = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    fileCache.set(name, template);
    // Smoke signal #1: visible in stdout the first time each prompt loads,
    // so a stale node.exe is obvious immediately after a deploy.
    logger.info(`[AI REVIEWER] prompt ${name} loaded (${template.length} chars)`);
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Prompt "${name}" references {{${key}}} but no value was supplied.`);
    }
    return vars[key];
  });
}
