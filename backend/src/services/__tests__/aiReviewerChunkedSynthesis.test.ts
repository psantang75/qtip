/**
 * Chunked synthesis pipeline (large-form path) — prompt builders.
 *
 * Pins the contract for the two new builders + grouper introduced for
 * the chunked synthesis pipeline:
 *
 *   - buildReasoningPrompt: Pass 2A — Opus, emits reasoning artefacts
 *     only (no answers[]). The 'reasoning' addendum is what enforces
 *     the "no answers" rule; this test pins that the BUILDER wires
 *     the right addendum and includes the right user-message blocks
 *     (form spec, traces, optional pivots / agreement).
 *
 *   - buildAnswerChunkPrompt: Pass 2B — Sonnet, one chunk per form
 *     CATEGORY. The user message MUST embed the reasoning artefacts
 *     verbatim AND the ALLOWED QUESTION IDS list. The CATEGORY FORM
 *     SPEC must be filtered to just this category's questions (so
 *     each chunk's prompt stays small).
 *
 *   - groupGradeableQuestionsByCategory: skips TEXT / INFO_BLOCK /
 *     SUB_CATEGORY questions, preserves form definition order, and
 *     drops categories with no gradeable questions (no LLM call
 *     should fire for an empty category).
 *
 * The full prompt assembly snapshot lives in
 * `aiReviewerPromptAssembly.test.ts` — this file pins the BUILDER
 * behaviour, not the addendum text.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../BasePromptService', () => {
  // Map each kind to a unique mock body so the test can assert which
  // assembled prompt the builder pulled. Real assembly logic lives in
  // BasePromptService.test.ts; here we only care about the wiring.
  const assembled = (kind: string) => ({
    id: 1,
    key: 'base.v1',
    version: 1,
    body: `<<MOCK ${kind.toUpperCase()} BASE>>`,
  });
  return {
    basePromptService: {
      getAssembledPrompt: vi.fn((kind: string) => assembled(kind)),
      getBaseForKind: vi.fn((kind: string) => assembled(kind)),
    },
    default: {
      getAssembledPrompt: vi.fn((kind: string) => assembled(kind)),
      getBaseForKind: vi.fn((kind: string) => assembled(kind)),
    },
  };
});

vi.mock('../RulePackService', () => ({
  rulePackService: {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
    getAlwaysIncludeUrlsForForm: vi.fn(() => []),
  },
  default: {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
    getAlwaysIncludeUrlsForForm: vi.fn(() => []),
  },
}));

import {
  buildReasoningPrompt,
  buildAnswerChunkPrompt,
  groupGradeableQuestionsByCategory,
  type SynthesisPromptInput,
} from '../aiReviewerTwoPassPrompts';
import type { FormForPrompt } from '../aiReviewerPrompt';

function makeForm(): FormForPrompt {
  return {
    id: 99018,
    form_name: 'Tech Ticket Process Review',
    interaction_type: 'TICKET',
    ai_review_guidance: null,
    categories: [
      { id: 1, category_name: 'Process' },
      { id: 2, category_name: 'Documentation' },
      { id: 3, category_name: 'Reviewer Notes' },
    ],
    questions: [
      // Process category — 2 gradeable, 1 non-gradeable header.
      { id: 11, category_name: 'Process', question_text: 'P-Header', question_type: 'SUB_CATEGORY', is_na_allowed: false, radio_options: [] },
      { id: 12, category_name: 'Process', question_text: 'Did the agent follow the playbook?', question_type: 'YES_NO', is_na_allowed: true, radio_options: [] },
      { id: 13, category_name: 'Process', question_text: 'How would you rate adherence?', question_type: 'RADIO', is_na_allowed: false, radio_options: [{ value: 'Strong' }, { value: 'Weak' }] },
      // Documentation category — 1 gradeable, 1 INFO_BLOCK skipped.
      { id: 21, category_name: 'Documentation', question_text: 'Notes complete?', question_type: 'YES_NO', is_na_allowed: false, radio_options: [] },
      { id: 22, category_name: 'Documentation', question_text: 'See KB link', question_type: 'INFO_BLOCK', is_na_allowed: false, radio_options: [] },
      // Reviewer Notes — only TEXT, should be dropped from grouping.
      { id: 31, category_name: 'Reviewer Notes', question_text: 'Anything to add?', question_type: 'TEXT', is_na_allowed: false, radio_options: [] },
    ],
  } as unknown as FormForPrompt;
}

function makeSynthesisInput(): SynthesisPromptInput {
  return {
    form: makeForm(),
    traces: [
      {
        sourceKind: 'TICKET',
        sourceId: '12345',
        traceJson: '{"playbook_steps":[],"timeline":[],"observations":[],"extracted_claims":[]}',
        header: {},
      },
    ],
    corrections: [],
    pivots: [],
    traceAgreements: [],
  };
}

describe('groupGradeableQuestionsByCategory', () => {
  it('skips TEXT / INFO_BLOCK / SUB_CATEGORY and drops empty categories', () => {
    const groups = groupGradeableQuestionsByCategory(makeForm());
    expect(groups).toEqual([
      { category: 'Process', questionIds: [12, 13] },
      { category: 'Documentation', questionIds: [21] },
      // Reviewer Notes has only a TEXT question -> no chunk produced.
    ]);
  });

  it('preserves form definition order', () => {
    const groups = groupGradeableQuestionsByCategory(makeForm());
    expect(groups.map((g) => g.category)).toEqual(['Process', 'Documentation']);
  });
});

describe('buildReasoningPrompt', () => {
  it('uses the reasoning addendum (not synthesis or single_source)', () => {
    const { system } = buildReasoningPrompt(makeSynthesisInput());
    expect(system).toContain('<<MOCK REASONING BASE>>');
    expect(system).not.toContain('<<MOCK SYNTHESIS BASE>>');
    expect(system).not.toContain('<<MOCK SINGLE_SOURCE BASE>>');
  });

  it('renders the form spec and instructs the model to emit draft_answers for every gradeable id', () => {
    const { user } = buildReasoningPrompt(makeSynthesisInput());
    // CONSISTENCY REFACTOR (W1.1): the reasoning pass IS the source
    // of truth for verdicts. It must emit one `draft_answers` entry
    // per gradeable question_id; rubrics are authoritative.
    expect(user).toContain('FORM SPEC');
    expect(user).toContain('draft_answers');
    expect(user).toContain('EVERY gradeable question_id');
    // All gradeable questions should still be visible — the reasoning
    // pass shapes its timeline / observations around them.
    expect(user).toContain('q12 [YES_NO');
    expect(user).toContain('q13 [RADIO');
    expect(user).toContain('q21 [YES_NO');
  });

  it('embeds every per-source trace block, primary first', () => {
    const input = makeSynthesisInput();
    input.traces.push({
      sourceKind: 'CALL',
      sourceId: 'call-uuid-2',
      traceJson: '{"k":"v2"}',
      header: {},
    });
    const { user } = buildReasoningPrompt(input);
    expect(user).toContain('PER-SOURCE TRACES');
    expect(user.indexOf('ROLE: PRIMARY')).toBeLessThan(user.indexOf('ROLE: ATTACHED'));
    expect(user).toContain('SOURCE_KIND: TICKET');
    expect(user).toContain('SOURCE_KIND: CALL');
  });
});

describe('buildAnswerChunkPrompt', () => {
  function makeChunkInput(categoryName: string, questionIds: number[]) {
    return {
      form: makeForm(),
      categoryName,
      questionIds,
      reasoning: { reasoningJson: '{"playbook_steps":[],"narrative":"REASONING_ARTEFACT_BODY"}' },
      traces: makeSynthesisInput().traces,
      corrections: [],
      pivots: [],
      traceAgreements: [],
    };
  }

  it('uses the answers_chunk addendum', () => {
    const { system } = buildAnswerChunkPrompt(makeChunkInput('Process', [12, 13]));
    expect(system).toContain('<<MOCK ANSWERS_CHUNK BASE>>');
  });

  it('lists the ALLOWED QUESTION IDS verbatim', () => {
    const { user } = buildAnswerChunkPrompt(makeChunkInput('Process', [12, 13]));
    expect(user).toContain('ALLOWED QUESTION IDS');
    expect(user).toMatch(/ALLOWED QUESTION IDS[^\n]*: 12, 13/);
  });

  it('renders ONLY the listed question_ids in the CATEGORY FORM SPEC', () => {
    const { user } = buildAnswerChunkPrompt(makeChunkInput('Process', [12, 13]));
    expect(user).toContain('CATEGORY FORM SPEC');
    expect(user).toContain('q12 [YES_NO');
    expect(user).toContain('q13 [RADIO');
    // Question 21 belongs to a different category — must NOT leak in.
    expect(user).not.toContain('q21 [YES_NO');
    // Non-gradeable items in the same category (q11 SUB_CATEGORY) must
    // also not appear — they aren't in the questionIds list.
    expect(user).not.toContain('q11 ');
  });

  it('embeds the reasoning artefacts verbatim under REASONING ARTEFACTS', () => {
    const { user } = buildAnswerChunkPrompt(makeChunkInput('Process', [12, 13]));
    expect(user).toContain('REASONING ARTEFACTS');
    expect(user).toContain('REASONING_ARTEFACT_BODY');
  });

  it('embeds the per-source trace blocks for verbatim evidence quotes', () => {
    const { user } = buildAnswerChunkPrompt(makeChunkInput('Process', [12, 13]));
    expect(user).toContain('PER-SOURCE TRACES');
    expect(user).toContain('--- SOURCE TRACE ---');
    expect(user).toContain('SOURCE_KIND: TICKET');
  });

  it('mentions the chunk category name so the model has a label for the slice', () => {
    const { user } = buildAnswerChunkPrompt(makeChunkInput('Documentation', [21]));
    expect(user).toContain('category="Documentation"');
  });
});
