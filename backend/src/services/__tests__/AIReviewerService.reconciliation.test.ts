/**
 * Reasoning-pass `draft_answers[]` parsing + reconciliation fallback
 * (Workstream 1.3).
 *
 * Covers:
 *   - parseDraftAnswers tolerates mild schema drift (verdict casing,
 *     "answer" alias, partial evidence_pointer)
 *   - parseDraftAnswers ignores rows missing question_id or with an
 *     unknown verdict
 *   - runReconciliationPass deferred-to-draft fallback when the LLM
 *     call fails (the chunk should NEVER beat the holistic reasoning
 *     view on a transport error — that's the whole point of the
 *     "tie-break in favor of reasoning" rule)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../BasePromptService', () => {
  const stub = { id: 1, key: 'base.v1', version: 1, body: '<<MOCK>>' };
  const service = {
    getAssembledPrompt: vi.fn(() => stub),
    getBaseForKind: vi.fn(() => stub),
  };
  return { basePromptService: service, default: service };
});

vi.mock('../RulePackService', () => {
  const service = {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
    getAlwaysIncludeUrlsForForm: vi.fn(() => []),
  };
  return { rulePackService: service, default: service };
});

// Fail every chat-model call so the reconciliation pass exercises its
// fallback path (the "transport error -> defer to reasoning draft"
// branch, which is the most important safety property of the
// reconciliation step).
vi.mock('../ai/ChatModelClient', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    callChatModel: vi.fn(async () => {
      throw new Error('transient transport failure');
    }),
  };
});

// withCallLog wraps callChatModel; stub it so the fallback path
// surfaces the thrown error and the reconciliation fail-safe fires.
vi.mock('../aiCallLogger', () => ({
  withCallLog: vi.fn(async (_ctx, _prompt, fn) => {
    return (await fn()).result;
  }),
}));

import { _internal } from '../AIReviewerService';

describe('parseDraftAnswers (W1.3)', () => {
  it('parses well-formed drafts into a Map keyed by question_id', () => {
    const map = _internal.parseDraftAnswers({
      draft_answers: [
        {
          question_id: 42,
          verdict: 'yes',
          brief_rationale: 'Agent followed step.',
          evidence_pointer: { source_kind: 'CALL', source_id: 'c1', where: '[01:24]' },
        },
        {
          question_id: 43,
          verdict: 'na',
          brief_rationale: 'Gate triggered NA.',
        },
      ],
    });
    expect(map.size).toBe(2);
    expect(map.get(42)?.verdict).toBe('yes');
    expect(map.get(42)?.brief_rationale).toBe('Agent followed step.');
    expect(map.get(42)?.evidence_pointer?.where).toBe('[01:24]');
    expect(map.get(43)?.verdict).toBe('na');
  });

  it('tolerates verdict casing and the "answer" alias', () => {
    const map = _internal.parseDraftAnswers({
      draft_answers: [
        { question_id: 1, verdict: 'YES', brief_rationale: 'a' },
        { question_id: 2, answer: 'No', brief_rationale: 'b' },
        { question_id: 3, verdict: 'NA', brief_rationale: 'c' },
      ],
    });
    expect(map.get(1)?.verdict).toBe('yes');
    expect(map.get(2)?.verdict).toBe('no');
    expect(map.get(3)?.verdict).toBe('na');
  });

  it('skips rows missing question_id or with an unknown verdict', () => {
    const map = _internal.parseDraftAnswers({
      draft_answers: [
        { verdict: 'yes', brief_rationale: 'missing id' },
        { question_id: 'not a number', verdict: 'yes' },
        { question_id: 99, verdict: 'maybe', brief_rationale: 'bad verdict' },
        { question_id: 100, verdict: 'yes', brief_rationale: 'ok' },
      ],
    });
    expect(map.size).toBe(1);
    expect(map.get(100)?.verdict).toBe('yes');
  });

  it('returns an empty map when draft_answers is missing or not an array', () => {
    expect(_internal.parseDraftAnswers({}).size).toBe(0);
    expect(_internal.parseDraftAnswers({ draft_answers: null }).size).toBe(0);
    expect(_internal.parseDraftAnswers({ draft_answers: 'oops' }).size).toBe(0);
  });
});

describe('extractNarrative (W1.3)', () => {
  it('returns the narrative string verbatim, truncated at 2000 chars', () => {
    const long = 'x'.repeat(3000);
    expect(_internal.extractNarrative({ narrative: 'short' })).toBe('short');
    expect(_internal.extractNarrative({ narrative: long }).length).toBe(2000);
  });

  it('joins array-shaped narratives with newlines', () => {
    expect(_internal.extractNarrative({ narrative: ['line a', 'line b'] })).toBe('line a\nline b');
  });

  it('returns "" for missing narrative', () => {
    expect(_internal.extractNarrative({})).toBe('');
  });
});

describe('runReconciliationPass — fallback (W1.3)', () => {
  it('falls back to the reasoning draft verdict when the LLM call fails', async () => {
    const out = await _internal.runReconciliationPass(
      {
        questionId: 99325,
        questionText: 'Did the agent use the customer\'s first name?',
        rubricMd: 'YES if used after verification.',
        draftVerdict: 'yes',
        draftRationale: 'Agent said "Alright, and Ben" at [01:24].',
        chunkVerdict: 'no',
        chunkDissentReason: 'Could not find a literal "Ben" reference.',
        chunkEvidenceQuote: '',
        narrativeExcerpt: 'Rapport was strong throughout the call.',
      },
      { provider: 'anthropic', purpose: 'test.reconcile' } as any,
      'anthropic'
    );
    expect(out.verdict).toBe('yes');
    expect(out.rationale).toMatch(/reconciliation unavailable/i);
    expect(out.rationale).toContain('Alright, and Ben');
  });
});
