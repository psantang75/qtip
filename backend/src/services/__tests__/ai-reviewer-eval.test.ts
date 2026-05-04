/**
 * AI Reviewer regression eval — gated test suite.
 *
 * Disabled by default because it makes real LLM calls (cost) and hits the
 * dev BookStack + CRM. To run:
 *
 *   RUN_AI_EVAL=1 npx vitest run src/services/__tests__/ai-reviewer-eval.test.ts
 *
 * The suite passes when per-provider agreement against the human-graded
 * 'expected' answers meets the threshold in golden.json (default 0.85).
 * Records with `expected: null` are skipped (reported as 'unscored') and
 * do NOT count toward the agreement number — so the suite remains
 * meaningful as the file gets graded incrementally.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnections } from '../../config/database';
import { runEval } from './ai-reviewer-golden/runEval';

const AI_EVAL_ENABLED = process.env.RUN_AI_EVAL === '1';
const describeAi = describe.skipIf(!AI_EVAL_ENABLED);

afterAll(async () => {
  if (AI_EVAL_ENABLED) await closeDatabaseConnections();
});

describeAi('AI Reviewer golden eval', () => {
  it('Anthropic agreement meets threshold', async () => {
    const report = await runEval({ providers: ['anthropic'] });
    const stats = report.per_provider.anthropic;
    expect(stats, 'anthropic provider stats present').toBeDefined();
    // Vacuous pass when no human ground truth is available yet — keeps the
    // gate green during seed phase but becomes a real check once tickets
    // are graded.
    expect(stats!.passed, `anthropic agreement ${(stats!.overall_agreement * 100).toFixed(1)}% < threshold ${(stats!.threshold * 100).toFixed(0)}%`).toBe(true);
  }, 600_000); // up to 10 min for a 13-ticket sweep

  it('OpenAI agreement meets threshold (when configured)', async () => {
    if (!process.env.OPENAI_API_KEY) {
      // eslint-disable-next-line no-console
      console.warn('[ai-eval] OPENAI_API_KEY not set; skipping OpenAI side of the eval.');
      return;
    }
    const report = await runEval({ providers: ['openai'] });
    const stats = report.per_provider.openai;
    expect(stats, 'openai provider stats present').toBeDefined();
    expect(stats!.passed, `openai agreement ${(stats!.overall_agreement * 100).toFixed(1)}% < threshold ${(stats!.threshold * 100).toFixed(0)}%`).toBe(true);
  }, 1_200_000); // OpenAI runs ~4x slower
});
