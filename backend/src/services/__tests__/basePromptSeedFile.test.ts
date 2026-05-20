/**
 * Seed-file regression guard (Workstream D3).
 *
 * `BasePromptService` re-seeds the universal Base prompt from
 * `backend/prompts/ai-reviewer/base.v1.md` whenever a fresh database is
 * bootstrapped (no `ai_base_prompt` row exists yet). If the seed file
 * drifts from the live DB version, every new dev/test environment will
 * boot with the OLD prompt — including a category-driven narrative
 * being reverted to the legacy six-label one we shipped 99076 with.
 *
 * This test reads the seed file directly and pins the small set of
 * markers that must be present so that drift is caught at PR time
 * instead of after a fresh-checkout dev complains their narratives
 * regressed.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const BASE_PATH = path.join(__dirname, '..', '..', '..', 'prompts', 'ai-reviewer', 'base.v1.md');
const TRACE_PATH = path.join(__dirname, '..', '..', '..', 'prompts', 'ai-reviewer', 'trace.v1.md');

describe('base.v1.md seed file (D3 regression guard)', () => {
  it('contains the category-driven narrative format section', async () => {
    const body = await fs.readFile(BASE_PATH, 'utf8');
    expect(body).toContain('Narrative format');
    expect(body).toContain('CATEGORY-DRIVEN');
    expect(body).toContain('ONE bullet line per CATEGORY');
    // Hard guard against the legacy six-label narrative regressing in.
    expect(body).not.toMatch(/Bethany's six-label narrative/i);
  });

  it('keeps the universal grading-rule anchors present', async () => {
    const body = await fs.readFile(BASE_PATH, 'utf8');
    expect(body).toContain('You are the AI Reviewer for Q-Tip');
    expect(body).toContain('Audit chain');
    expect(body).toContain('Universal KB authorities');
    expect(body).toContain('Grading philosophy');
  });
});

describe('trace.v1.md seed file (D4 regression guard)', () => {
  it('mandates kb_citations + empty-KB documentation observation', async () => {
    const body = await fs.readFile(TRACE_PATH, 'utf8');
    expect(body).toContain('kb_citations');
    expect(body).toContain('kb_gap:');
    expect(body).toContain('REQUIRED');
  });
});
