/**
 * Closed-loop prompt test (Calibration → Prompt feedback path).
 *
 * Asserts that:
 *   1. With no corrections passed, the new file-loaded prompt is
 *      byte-identical to the legacy inline prompt (preserves the
 *      Phase 2 byte-equivalence guarantee — covered also by the
 *      sibling equivalence.test, repeated here for clarity).
 *   2. With corrections passed, the system prompt grows a
 *      `LEARNED CORRECTIONS FROM HUMAN REVIEWERS` section AND the
 *      file-loaded version still matches the inline implementation
 *      byte-for-byte (so the inline regression baseline tracks the
 *      corrections feature).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAiReviewerPrompt,
  _buildAiReviewerPromptInline,
  type PromptInput,
  type FormForPrompt,
} from '../aiReviewerPrompt';
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
    source: 'qa_promoted_draft',
    created_at: new Date('2026-04-28T13:14:00.000Z'),
    data_point_id: 42,
    correction_reason: null,
    ...overrides,
  };
}

describe('aiReviewerPrompt — calibration corrections injection', () => {
  it('omits the corrections section entirely when none provided (byte-equivalent baseline)', () => {
    clearPromptCache();
    const fileBased = buildAiReviewerPrompt(makeInput());
    const inline = _buildAiReviewerPromptInline(makeInput());
    expect(fileBased.system).toBe(inline.system);
    expect(fileBased.user).toBe(inline.user);
    expect(fileBased.system).not.toContain('LEARNED CORRECTIONS');
  });

  it('omits when corrections is an empty array', () => {
    clearPromptCache();
    const fileBased = buildAiReviewerPrompt(makeInput([]));
    expect(fileBased.system).not.toContain('LEARNED CORRECTIONS');
  });

  it('appends a LEARNED CORRECTIONS section in the system prompt when corrections are present', () => {
    clearPromptCache();
    const c = makeCorrection();
    const fileBased = buildAiReviewerPrompt(makeInput([c]));
    expect(fileBased.system).toContain('LEARNED CORRECTIONS FROM HUMAN REVIEWERS');
    expect(fileBased.system).toContain(`Question: "${c.question_text}"`);
    expect(fileBased.system).toContain('AI previously answered: yes');
    expect(fileBased.system).toContain('Human corrected to: no');
    expect(fileBased.system).toContain('Source: ticket #279060');
  });

  it('keeps the inline implementation byte-equivalent when corrections are passed (baseline tracks feature)', () => {
    clearPromptCache();
    const c1 = makeCorrection({ question_id: 99125, ai_value: 'yes', human_value: 'no', ticket_id: 1 });
    const c2 = makeCorrection({ question_id: 12345, question_text: 'How would you rate the resolution?', ai_value: 'great', human_value: 'poor', ticket_id: 2 });
    const input = makeInput([c1, c2]);
    const fileBased = buildAiReviewerPrompt(input);
    const inline = _buildAiReviewerPromptInline(input);
    expect(fileBased.system).toBe(inline.system);
    expect(fileBased.user).toBe(inline.user);
  });

  it("renders the reviewer's reason when correction_reason is present", () => {
    clearPromptCache();
    const c = makeCorrection({ correction_reason: 'Vague description; agent did not restate symptom.' });
    const fileBased = buildAiReviewerPrompt(makeInput([c]));
    expect(fileBased.system).toContain("Reviewer's reason: Vague description; agent did not restate symptom.");
  });

  /**
   * Phase 2a guarantee: absorbed calibration rows are filtered out of
   * the few-shot input by AICalibrationService.getRecentCorrections, so
   * the only corrections passed into the prompt builder are non-absorbed
   * ones. We assert here that an empty corrections array produces a
   * prompt with NO learned-corrections section, matching the contract
   * the absorb sweep relies on. (If the prompt builder later starts
   * synthesizing corrections from elsewhere, this test will catch it.)
   */
  it('absorbed-corrections contract: empty array means no learned-corrections section in the prompt', () => {
    clearPromptCache();
    const fileBased = buildAiReviewerPrompt(makeInput([]));
    expect(fileBased.system).not.toContain('LEARNED CORRECTIONS');
    expect(fileBased.system).not.toContain('AI previously answered');
  });
});
