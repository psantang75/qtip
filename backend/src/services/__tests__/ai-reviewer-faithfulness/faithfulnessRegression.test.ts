/**
 * Phase D (D5): faithfulness regression test.
 *
 * Replays every (ticket, call) pair listed in `faithfulness.fixture.json`
 * through the AI Reviewer's two-pass pipeline and asserts that the
 * synthesis output's `faithfulness.discrepancies[]` covers >= 90% of
 * the hand-labeled discrepancies.
 *
 * The fixture starts empty by design — the entries are something a QA
 * lead populates from real audited cases (see the `_doc` block in the
 * JSON file). This test:
 *
 *   - Auto-skips when the fixture is empty so CI stays green while the
 *     set is being assembled.
 *   - Auto-skips when running outside an integration env (no
 *     `AI_REVIEWER_FAITHFULNESS_LIVE=1`). The two-pass pipeline hits
 *     Anthropic + BookStack + the CRM, none of which we want to spin
 *     up in unit-test runs.
 *   - Runs sequentially (NOT in parallel) when live, so the cost guard
 *     and rate limiter aren't surprised.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { readFileSync } from 'fs';

interface ExpectedDiscrepancy {
  kind: 'missing_in_notes' | 'contradiction' | 'embellishment' | 'pii_leak';
  summary_substring: string;
  severity_floor: 'info' | 'warn' | 'critical';
}

interface FaithfulnessEntry {
  case_id: string;
  ticket_id: number;
  conversation_id: string;
  expected_discrepancies: ExpectedDiscrepancy[];
}

const SEVERITY_RANK: Record<ExpectedDiscrepancy['severity_floor'], number> = {
  info: 0,
  warn: 1,
  critical: 2,
};

const FIXTURE_PATH = path.resolve(__dirname, 'faithfulness.fixture.json');

function loadEntries(): FaithfulnessEntry[] {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { entries?: FaithfulnessEntry[] };
  return parsed.entries ?? [];
}

const LIVE = process.env.AI_REVIEWER_FAITHFULNESS_LIVE === '1';

describe('AI Reviewer faithfulness regression set', () => {
  const entries = loadEntries();

  if (entries.length === 0) {
    it.skip('fixture is empty; populate ai-reviewer-faithfulness/faithfulness.fixture.json with real cases', () => {});
    return;
  }
  if (!LIVE) {
    it.skip('set AI_REVIEWER_FAITHFULNESS_LIVE=1 to run the live two-pass replay', () => {});
    return;
  }

  it('catches >= 90% of hand-labeled discrepancies', async () => {
    const aiReviewerService = (await import('../../AIReviewerService')).default;
    const { buildSynthesisPrompt, buildTracePrompt } = await import('../../aiReviewerTwoPassPrompts');
    if (!aiReviewerService.isConfigured()) {
      throw new Error('AIReviewerService is not configured for live regression run');
    }
    // The two-pass orchestrator isn't wired up end-to-end yet (that's
    // the C-phase plumbing the synthesis pass directly into a single
    // analyze() call). Until then, this regression test asserts the
    // builders work and leaves the actual replay TODO so CI flips
    // green only after a hand-populated fixture AND the orchestrator
    // are both ready.
    expect(typeof buildSynthesisPrompt).toBe('function');
    expect(typeof buildTracePrompt).toBe('function');

    let total = 0;
    let caught = 0;
    for (const entry of entries) {
      // TODO(D-final-wire): replay each entry through the two-pass
      // orchestrator once it's exposed on AIReviewerService. For now,
      // only count the entry as "evaluated" so CI shows progress
      // without false-negative pressure.
      total += entry.expected_discrepancies.length;
      void entry; void SEVERITY_RANK; // referenced once orchestrator lands
    }
    if (total === 0) return;
    const pct = caught / total;
    expect(pct).toBeGreaterThanOrEqual(0.9);
  });
});
