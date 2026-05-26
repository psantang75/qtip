/**
 * Tests for AnswersToolSchema — the schema builder that constrains AI
 * Reviewer answers to legal values per question_id via Anthropic
 * tool-use. The whole point of this layer is that 'yes' for a RADIO
 * whose options are ['Inbound','Outbound'] is physically impossible —
 * so the tests pin down the per-type enum shapes that make that true.
 */

import { describe, it, expect } from 'vitest';
import { buildAnswersTool, getGradeableQuestionIds } from '../AnswersToolSchema';
import type { FormForPrompt } from '../../aiReviewerPrompt';

function q(
  overrides: Partial<FormForPrompt['questions'][number]>
): FormForPrompt['questions'][number] {
  return {
    id: 1,
    category_name: 'Test Category',
    question_text: 'Test?',
    question_type: 'YES_NO',
    yes_value: 1,
    no_value: 0,
    na_value: -1,
    is_na_allowed: false,
    radio_options: [],
    role: 'DETAIL',
    ...overrides,
  };
}

function form(
  questions: FormForPrompt['questions']
): FormForPrompt {
  return {
    id: 1,
    form_name: 'Test',
    interaction_type: 'TICKET',
    categories: [{ id: 1, category_name: 'Test Category' }],
    questions,
  };
}

describe('buildAnswersTool — per-type value constraints', () => {
  it('emits a yes/no enum for YES_NO with NA not allowed', () => {
    const t = buildAnswersTool(
      form([q({ id: 100, question_type: 'YES_NO', is_na_allowed: false })]),
      [100],
      'single_source'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.question_id).toEqual({ const: 100 });
    expect(branch.value).toEqual({ enum: ['yes', 'no'] });
  });

  it('adds "na" to the YES_NO enum when is_na_allowed is true', () => {
    const t = buildAnswersTool(
      form([q({ id: 101, question_type: 'YES_NO', is_na_allowed: true })]),
      [101],
      'single_source'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.value).toEqual({ enum: ['yes', 'no', 'na'] });
  });

  it('emits an option-value enum for RADIO (the canonical Inbound/Outbound case)', () => {
    const t = buildAnswersTool(
      form([
        q({
          id: 200,
          question_type: 'RADIO',
          radio_options: [
            { value: 'Inbound', text: 'Inbound', score: 1 },
            { value: 'Outbound', text: 'Outbound', score: 1 },
          ],
        }),
      ]),
      [200],
      'answers_chunk'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.value).toEqual({ enum: ['Inbound', 'Outbound'] });
    // The bug we're killing: 'yes' MUST NOT be in the enum even though
    // the question text reads like a yes/no.
    expect(branch.value.enum).not.toContain('yes');
    expect(branch.value.enum).not.toContain('no');
  });

  it('supports N-option RADIO (more than two values)', () => {
    const t = buildAnswersTool(
      form([
        q({
          id: 201,
          question_type: 'RADIO',
          radio_options: [
            { value: 'Excellent', text: 'Excellent', score: 4 },
            { value: 'Good', text: 'Good', score: 3 },
            { value: 'Fair', text: 'Fair', score: 2 },
            { value: 'Poor', text: 'Poor', score: 1 },
            { value: 'Failing', text: 'Failing', score: 0 },
          ],
        }),
      ]),
      [201],
      'single_source'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.value.enum).toEqual(['Excellent', 'Good', 'Fair', 'Poor', 'Failing']);
  });

  it('supports opaque RADIO values ("1"/"2") with meaningful labels', () => {
    const t = buildAnswersTool(
      form([
        q({
          id: 202,
          question_type: 'RADIO',
          radio_options: [
            { value: '1', text: 'Inbound', score: 1 },
            { value: '2', text: 'Outbound', score: 1 },
          ],
        }),
      ]),
      [202],
      'single_source'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    // Enum carries option_value (the persistent token), NOT the human label.
    expect(branch.value).toEqual({ enum: ['1', '2'] });
  });

  it('emits an array-of-enum for MULTI_SELECT (rejecting yes/no inference)', () => {
    const t = buildAnswersTool(
      form([
        q({
          id: 300,
          question_type: 'MULTI_SELECT',
          radio_options: [
            { value: 'Email', text: 'Email', score: 1 },
            { value: 'Phone', text: 'Phone', score: 1 },
            { value: 'Chat', text: 'Chat', score: 1 },
          ],
        }),
      ]),
      [300],
      'answers_chunk'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.value).toEqual({
      type: 'array',
      items: { enum: ['Email', 'Phone', 'Chat'] },
      minItems: 1,
      uniqueItems: true,
    });
  });

  it('emits an integer constraint for SCALE', () => {
    const t = buildAnswersTool(
      form([q({ id: 400, question_type: 'SCALE' })]),
      [400],
      'single_source'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.value).toEqual({ type: 'integer' });
  });

  it('enforces array minItems/maxItems equal to the allowed question_ids count', () => {
    const t = buildAnswersTool(
      form([
        q({ id: 1, question_type: 'YES_NO' }),
        q({ id: 2, question_type: 'YES_NO' }),
        q({ id: 3, question_type: 'YES_NO' }),
      ]),
      [1, 2, 3],
      'answers_chunk'
    );
    expect(t.input_schema.properties.answers.minItems).toBe(3);
    expect(t.input_schema.properties.answers.maxItems).toBe(3);
    expect(t.input_schema.properties.answers.items.oneOf).toHaveLength(3);
  });

  it('attaches dissent fields in answers_chunk mode only', () => {
    const single = buildAnswersTool(
      form([q({ id: 1, question_type: 'YES_NO' })]),
      [1],
      'single_source'
    );
    const chunk = buildAnswersTool(
      form([q({ id: 1, question_type: 'YES_NO' })]),
      [1],
      'answers_chunk'
    );
    const singleBranch = (single.input_schema.properties.answers.items.oneOf[0] as any).properties;
    const chunkBranch = (chunk.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(singleBranch.dissent).toBeUndefined();
    expect(singleBranch.evidence_source_kind).toBeUndefined();
    expect(chunkBranch.dissent).toEqual({ type: 'boolean' });
    expect(chunkBranch.evidence_source_kind).toEqual({ enum: ['TICKET', 'TASK', 'CALL'] });
  });

  it('falls through to an unconstrained string when RADIO/MULTI_SELECT has no options', () => {
    const t = buildAnswersTool(
      form([q({ id: 1, question_type: 'RADIO', radio_options: [] })]),
      [1],
      'single_source'
    );
    const branch = (t.input_schema.properties.answers.items.oneOf[0] as any).properties;
    expect(branch.value).toEqual({ type: 'string' });
  });

  it('exposes the canonical tool name "submit_answers"', () => {
    const t = buildAnswersTool(
      form([q({ id: 1, question_type: 'YES_NO' })]),
      [1],
      'single_source'
    );
    expect(t.name).toBe('submit_answers');
  });
});

describe('getGradeableQuestionIds', () => {
  it('skips TEXT / INFO_BLOCK / SUB_CATEGORY and ROLLUP rows', () => {
    const ids = getGradeableQuestionIds(
      form([
        q({ id: 1, question_type: 'YES_NO' }),
        q({ id: 2, question_type: 'TEXT' }),
        q({ id: 3, question_type: 'INFO_BLOCK' }),
        q({ id: 4, question_type: 'SUB_CATEGORY' }),
        q({ id: 5, question_type: 'YES_NO', role: 'ROLLUP' }),
        q({ id: 6, question_type: 'RADIO' }),
      ])
    );
    expect(ids).toEqual([1, 6]);
  });
});
