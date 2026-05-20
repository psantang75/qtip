/**
 * Per-question rubrics — DB-backed loader + writer.
 *
 * Coverage:
 *   - warmFormRubricsCache hydrates the per-form map from Prisma
 *   - loadFormRubrics returns the cached map (sync) or empty before
 *     warm
 *   - upsertQuestionRubric writes via Prisma + refreshes cache so the
 *     synthesis prompt picks up the change immediately
 *   - empty rubric_md is treated as a delete (rubrics are optional)
 *   - deleteQuestionRubric is idempotent (P2025 swallowed)
 *   - buildSynthesisPrompt renders the RUBRIC: block under questions
 *     that have one and leaves un-rubric'd questions untouched
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { findManyMock, upsertMock, deleteMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    aiFormQuestionRubric: {
      findMany: findManyMock,
      upsert: upsertMock,
      delete: deleteMock,
    },
  },
}));

// Stub basePromptService so buildSynthesisPrompt resolves without a
// warmed BasePromptService cache (this test only cares that the rubric
// block is rendered into the system prompt, not the Base body content).
vi.mock('../BasePromptService', () => ({
  basePromptService: {
    getAssembledPrompt: vi.fn(() => ({
      id: 1,
      key: 'base.v1',
      version: 1,
      body: '<<MOCK ASSEMBLED BASE>>',
    })),
    getBaseForKind: vi.fn(() => ({
      id: 2,
      key: 'trace.v1',
      version: 1,
      body: '<<MOCK TRACE>>',
    })),
  },
  default: {
    getAssembledPrompt: vi.fn(() => ({
      id: 1,
      key: 'base.v1',
      version: 1,
      body: '<<MOCK ASSEMBLED BASE>>',
    })),
    getBaseForKind: vi.fn(() => ({
      id: 2,
      key: 'trace.v1',
      version: 1,
      body: '<<MOCK TRACE>>',
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

import {
  loadFormRubrics,
  warmFormRubricsCache,
  upsertQuestionRubric,
  deleteQuestionRubric,
  listQuestionRubricsForForm,
  _clearFormRubricsCache,
  _seedFormRubricsCache,
} from '../aiReviewerPrompt';
import { buildSynthesisPrompt } from '../aiReviewerTwoPassPrompts';
import type { FormForPrompt } from '../aiReviewerPrompt';

const TEST_FORM_ID = 999992;

beforeEach(() => {
  findManyMock.mockReset();
  upsertMock.mockReset();
  deleteMock.mockReset();
  _clearFormRubricsCache();
});

describe('warmFormRubricsCache + loadFormRubrics', () => {
  it('returns an empty map before the cache is warmed (test-safe default)', () => {
    expect(loadFormRubrics(TEST_FORM_ID).size).toBe(0);
  });

  it('hydrates the cache from Prisma and groups rubrics by form_id', async () => {
    findManyMock.mockResolvedValueOnce([
      { form_id: TEST_FORM_ID, question_id: 42, rubric_md: 'first rubric' },
      { form_id: TEST_FORM_ID, question_id: 43, rubric_md: 'second rubric' },
      { form_id: TEST_FORM_ID + 1, question_id: 7, rubric_md: 'other form' },
    ]);

    await warmFormRubricsCache();

    const a = loadFormRubrics(TEST_FORM_ID);
    expect(a.get(42)).toBe('first rubric');
    expect(a.get(43)).toBe('second rubric');
    const b = loadFormRubrics(TEST_FORM_ID + 1);
    expect(b.get(7)).toBe('other form');
  });

  it('skips empty / whitespace-only rubric rows during hydration', async () => {
    findManyMock.mockResolvedValueOnce([
      { form_id: TEST_FORM_ID, question_id: 42, rubric_md: 'real rubric' },
      { form_id: TEST_FORM_ID, question_id: 43, rubric_md: '   ' },
    ]);

    await warmFormRubricsCache();

    const map = loadFormRubrics(TEST_FORM_ID);
    expect(map.size).toBe(1);
    expect(map.get(42)).toBe('real rubric');
  });
});

describe('upsertQuestionRubric', () => {
  it('upserts via Prisma and refreshes the cache so the next read sees it', async () => {
    upsertMock.mockResolvedValueOnce({});
    findManyMock.mockResolvedValueOnce([
      { form_id: TEST_FORM_ID, question_id: 42, rubric_md: 'YES = empathy.' },
    ]);

    await upsertQuestionRubric(TEST_FORM_ID, 42, '  YES = empathy.  ', 7);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { form_id_question_id: { form_id: TEST_FORM_ID, question_id: 42 } },
        update: expect.objectContaining({ rubric_md: 'YES = empathy.', updated_by: 7 }),
        create: expect.objectContaining({
          form_id: TEST_FORM_ID,
          question_id: 42,
          rubric_md: 'YES = empathy.',
          updated_by: 7,
        }),
      }),
    );
    expect(loadFormRubrics(TEST_FORM_ID).get(42)).toBe('YES = empathy.');
  });

  it('treats empty / whitespace-only rubric_md as a delete request', async () => {
    deleteMock.mockResolvedValueOnce({});
    findManyMock.mockResolvedValueOnce([]);

    await upsertQuestionRubric(TEST_FORM_ID, 42, '   ', null);

    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith({
      where: { form_id_question_id: { form_id: TEST_FORM_ID, question_id: 42 } },
    });
  });

  it('rejects invalid form / question ids', async () => {
    await expect(upsertQuestionRubric(0, 42, 'x')).rejects.toThrow(/form id/i);
    await expect(upsertQuestionRubric(1, 0, 'x')).rejects.toThrow(/question id/i);
  });
});

describe('deleteQuestionRubric', () => {
  it('swallows P2025 (record not found) and refreshes cache', async () => {
    deleteMock.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'P2025' }));
    findManyMock.mockResolvedValueOnce([]);

    await expect(deleteQuestionRubric(TEST_FORM_ID, 42)).resolves.toBeUndefined();
  });

  it('rethrows non-P2025 errors', async () => {
    deleteMock.mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'P2002' }));
    await expect(deleteQuestionRubric(TEST_FORM_ID, 42)).rejects.toThrow(/connection lost/);
  });
});

describe('listQuestionRubricsForForm', () => {
  it('returns rows for a form, ordered by question_id', async () => {
    findManyMock.mockResolvedValueOnce([
      { question_id: 1, rubric_md: 'a', updated_by: null, updated_at: new Date() },
      { question_id: 2, rubric_md: 'b', updated_by: 7, updated_at: new Date() },
    ]);

    const out = await listQuestionRubricsForForm(TEST_FORM_ID);
    expect(out).toHaveLength(2);
    expect(out[0].question_id).toBe(1);
    expect(out[1].rubric_md).toBe('b');
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { form_id: TEST_FORM_ID },
        orderBy: { question_id: 'asc' },
      }),
    );
  });

  it('returns [] for invalid form id without hitting Prisma', async () => {
    const out = await listQuestionRubricsForForm(0);
    expect(out).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe('buildSynthesisPrompt — rubric integration', () => {
  function makeForm(formId: number): FormForPrompt {
    return {
      id: formId,
      form_name: 'Empathy Form',
      interaction_type: 'CALL',
      ai_review_guidance: null,
      categories: [{ id: 1, category_name: 'Soft skills' }],
      questions: [
        {
          id: 42,
          category_name: 'Soft skills',
          question_text: 'Did the agent show empathy?',
          question_type: 'YES_NO',
          yes_value: 1,
          no_value: 0,
          na_value: 0,
          is_na_allowed: false,
          radio_options: [],
        },
        {
          id: 43,
          category_name: 'Soft skills',
          question_text: 'Did the agent collect or confirm a ZIP code?',
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

  it('renders a RUBRIC: block only under questions that have a rubric', () => {
    _seedFormRubricsCache(
      TEST_FORM_ID,
      new Map([[42, 'YES = at least one verbal acknowledgement.\nNO  = transactional only.']]),
    );

    const { user } = buildSynthesisPrompt({
      form: makeForm(TEST_FORM_ID),
      corrections: [],
      traces: [{ sourceKind: 'CALL', sourceId: 'abc', traceJson: '{}', header: {} }],
    });

    expect(user).toContain('q42 [YES_NO]');
    expect(user).toMatch(/q42 \[YES_NO\][^\n]*\n\s+RUBRIC:/);
    expect(user).toContain('YES = at least one verbal acknowledgement.');

    const q43Idx = user.indexOf('q43 [YES_NO]');
    const sliceAfterQ43 = user.slice(q43Idx, q43Idx + 200);
    expect(sliceAfterQ43).not.toContain('RUBRIC:');
  });

  it('renders no RUBRIC blocks when the form has no rubrics', () => {
    const { user } = buildSynthesisPrompt({
      form: makeForm(TEST_FORM_ID),
      corrections: [],
      traces: [{ sourceKind: 'CALL', sourceId: 'abc', traceJson: '{}', header: {} }],
    });
    expect(user).not.toContain('RUBRIC:');
  });
});
