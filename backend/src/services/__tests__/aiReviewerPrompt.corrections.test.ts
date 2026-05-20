/**
 * Closed-loop prompt test (Calibration → Prompt feedback path).
 *
 * Asserts that:
 *   1. With no corrections passed, the assembled system prompt does NOT
 *      include the LEARNED CORRECTIONS section.
 *   2. With corrections passed, the system prompt grows a
 *      `LEARNED CORRECTIONS FROM HUMAN REVIEWERS` section that renders
 *      the question text, the AI's previous answer, the human's
 *      correction, the source ticket, and (when present) the
 *      reviewer's reason.
 *
 * The Base prompt is mocked through `basePromptService.getAssembledPrompt`
 * so the test does not need a warmed cache or DB. The prior
 * byte-equivalence assertions against `_buildAiReviewerPromptInline`
 * were removed in the unified-Base refactor — the inline implementation
 * is no longer the regression baseline (the prompt is now Base body +
 * addendum and is materially different from the legacy `system.v3`).
 * The new regression gate is the snapshot test in
 * `aiReviewerPromptAssembly.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock basePromptService BEFORE importing aiReviewerPrompt so the
// module resolves the mocked version at import time. The fixture body
// is intentionally short — we only need to verify how
// buildAiReviewerPrompt composes the AROUND text, not the contents of
// the Base prompt itself.
vi.mock('../BasePromptService', () => ({
  basePromptService: {
    getAssembledPrompt: vi.fn(() => ({
      id: 1,
      key: 'base.v1',
      version: 1,
      body: '<<MOCK ASSEMBLED BASE>>',
    })),
  },
  default: {
    getAssembledPrompt: vi.fn(() => ({
      id: 1,
      key: 'base.v1',
      version: 1,
      body: '<<MOCK ASSEMBLED BASE>>',
    })),
  },
}));

vi.mock('../RulePackService', () => ({
  rulePackService: {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
  },
  default: {
    renderPacksForPrompt: vi.fn(() => ''),
    getPacksForForm: vi.fn(() => []),
  },
}));

import { buildAiReviewerPrompt, type PromptInput, type FormForPrompt } from '../aiReviewerPrompt';
import type { CRMNote } from '../CRMService';
import type { CalibrationCorrection } from '../AICalibrationService';
import { clearPromptCache } from '../promptLoader';

function makeForm(): FormForPrompt {
  return {
    id: 99016,
    form_name: 'Tech Ticket Review - Sub-classification, Resolution and Process',
    interaction_type: 'TICKET',
    ai_review_guidance: null,
    categories: [{ id: 1, category_name: 'Ticket Review' }],
    questions: [
      {
        id: 99125,
        category_name: 'Ticket Review',
        question_text: "Did the selected Subclass accurately reflect the customer's issue?",
        question_type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        na_value: 0,
        is_na_allowed: false,
        radio_options: [],
      },
    ],
  };
}

function makeNotes(): CRMNote[] {
  return [
    {
      id: 1,
      note: 'Customer called back; resolved.',
      created_on: '2026-04-28T13:14:00.000Z',
      created_by: 23,
      created_by_name: 'Bethany Smith',
      status_after: null,
      next_contact_date: null,
      is_after_audit: false,
    },
  ];
}

function makeInput(corrections?: CalibrationCorrection[]): PromptInput {
  return {
    form: makeForm(),
    adapterKind: 'TICKET',
    header: { ticket_id: '279060', classification: 'Tech Support' },
    notes: makeNotes(),
    kbHits: [],
    corrections,
  };
}

function makeCorrection(overrides: Partial<CalibrationCorrection> = {}): CalibrationCorrection {
  return {
    question_id: 99125,
    question_text: "Did the selected Subclass accurately reflect the customer's issue?",
    ai_value: 'yes',
    human_value: 'no',
    ticket_id: 279060,
    source_kind: 'TICKET',
    source: 'qa_promoted_draft',
    created_at: new Date('2026-04-28T13:14:00.000Z'),
    data_point_id: 42,
    correction_reason: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearPromptCache();
});

describe('aiReviewerPrompt — calibration corrections injection', () => {
  it('omits the corrections section entirely when none provided', () => {
    const built = buildAiReviewerPrompt(makeInput());
    expect(built.system).toContain('<<MOCK ASSEMBLED BASE>>');
    expect(built.system).not.toContain('LEARNED CORRECTIONS');
  });

  it('omits when corrections is an empty array', () => {
    const built = buildAiReviewerPrompt(makeInput([]));
    expect(built.system).not.toContain('LEARNED CORRECTIONS');
  });

  it('appends a LEARNED CORRECTIONS section in the system prompt when corrections are present', () => {
    const c = makeCorrection();
    const built = buildAiReviewerPrompt(makeInput([c]));
    expect(built.system).toContain('LEARNED CORRECTIONS FROM HUMAN REVIEWERS');
    expect(built.system).toContain(`Question: "${c.question_text}"`);
    expect(built.system).toContain('AI previously answered: yes');
    expect(built.system).toContain('Human corrected to: no');
    expect(built.system).toContain('Source: ticket #279060');
  });

  it("renders the reviewer's reason when correction_reason is present", () => {
    const c = makeCorrection({ correction_reason: 'Vague description; agent did not restate symptom.' });
    const built = buildAiReviewerPrompt(makeInput([c]));
    expect(built.system).toContain("Reviewer's reason: Vague description; agent did not restate symptom.");
  });

  /**
   * Phase 2a guarantee: absorbed calibration rows are filtered out of
   * the few-shot input by AICalibrationService.getRecentCorrections, so
   * the only corrections passed into the prompt builder are non-absorbed
   * ones. We assert here that an empty corrections array produces a
   * prompt with NO learned-corrections section, matching the contract
   * the absorb sweep relies on.
   */
  it('absorbed-corrections contract: empty array means no learned-corrections section in the prompt', () => {
    const built = buildAiReviewerPrompt(makeInput([]));
    expect(built.system).not.toContain('LEARNED CORRECTIONS');
    expect(built.system).not.toContain('AI previously answered');
  });
});
