/**
 * updateForm() — AI-overlay preservation tests.
 *
 * Locks in the rule that "Save" in the form builder (which under the
 * hood creates a brand-new form row + question rows under a new
 * version) MUST carry forward AI-overlay artifacts keyed to the prior
 * form/version:
 *   - ai_form_question_rubric (per-question, keyed via (category_name,
 *     sort_order) since question IDs change every version)
 *   - ai_form_rule_pack_assignment, ai_calibration_map,
 *     ai_calibration_data (per-form rows, just rewriting form_id)
 *   - parent_form_id (set to the prior form so versioning lineage is
 *     walkable)
 *   - All ai_* form-level columns (UI override wins, otherwise inherit
 *     the prior value, otherwise schema default)
 *
 * This is the regression behind submission 99075 silently dropping its
 * 84 rubrics when the form 99018 -> 99019 cutover happened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CreateFormDTO } from '../../models';

type ValueOrNull<T> = T | null;

const PREV_FORM_ID = 99018;
const NEW_FORM_ID = 99099;

const prevFormFixture = {
  id: PREV_FORM_ID,
  form_name: 'Contact Call Review Form (v2 AI Pilot)',
  interaction_type: 'CALL',
  version: 1,
  created_by: 1,
  is_active: true,
  parent_form_id: null as ValueOrNull<number>,
  user_version: null,
  user_version_date: null,
  critical_cap_percent: 60.0,
  ai_enabled: true,
  ai_review_guidance: '<<inherited guidance>>',
  ai_submit_as_draft: true,
  ai_sample_review_pct: 10,
  ai_sample_low_score_always: true,
  ai_sample_low_confidence_threshold: 0.55,
  ai_calibration_auto_absorb_days: 180,
  ai_monthly_cost_budget_usd: 500.0,
  ai_disagreement_route_threshold: 0.3,
  ai_max_attached_sources: 4,
  ai_base_prompt_id: 7,
  ai_model_provider: 'openai',
  form_categories: [
    {
      id: 11,
      category_name: 'Greeting',
      form_questions: [
        { id: 101, sort_order: 0 },
        { id: 102, sort_order: 1 },
      ],
    },
    {
      id: 12,
      category_name: 'Wrap-Up',
      form_questions: [{ id: 201, sort_order: 0 }],
    },
  ],
};

const prevRubrics = [
  { id: 1, form_id: PREV_FORM_ID, question_id: 101, rubric_md: 'RUBRIC for 101', updated_by: 9 },
  { id: 2, form_id: PREV_FORM_ID, question_id: 102, rubric_md: 'RUBRIC for 102', updated_by: null },
  { id: 3, form_id: PREV_FORM_ID, question_id: 201, rubric_md: 'RUBRIC for 201', updated_by: 9 },
];
const prevRulePacks = [
  { id: 1, form_id: PREV_FORM_ID, rule_pack_id: 5, sort_order: 0, updated_by: 9 },
  { id: 2, form_id: PREV_FORM_ID, rule_pack_id: 8, sort_order: 1, updated_by: null },
];
const prevCalibMaps = [
  { id: 1, form_id: PREV_FORM_ID, version: 1, sample_count: 50, bins_json: { bins: [0, 1] }, is_active: true, notes: 'v1 fit' },
];
const prevCalibData = [
  {
    id: 1,
    form_id: PREV_FORM_ID,
    ticket_id: 999,
    source: 'CRM',
    source_kind: 'TICKET',
    ai_submission_id: 50,
    human_submission_id: 51,
    ai_answers: { a: 'yes' },
    human_answers: { a: 'no' },
    graded_by: 9,
    in_rolling_set: true,
    notes: 'training row',
    absorbed_at: null,
    absorbed_by: null,
    absorbed_reason: null,
  },
];

// We capture every create payload the repo issues against tx.* so we
// can assert on exactly what was written.
const captured = {
  form: [] as any[],
  formCategory: [] as any[],
  formQuestion: [] as any[],
  rubric: [] as any[],
  rulePack: [] as any[],
  calibMap: [] as any[],
  calibData: [] as any[],
};

// Auto-increment the new question IDs in the same order the repo
// creates them so we can verify the oldQid -> newQid mapping.
let nextQuestionId = 0;
let nextCategoryId = 0;

const { findUniqueMock, transactionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    form: { findUnique: findUniqueMock },
    $transaction: transactionMock,
  },
}));

import { MySQLFormRepository } from '../MySQLFormRepository';

function makeTx() {
  // Stub tx that records create payloads and synthesises IDs the way
  // Prisma would.
  return {
    form: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(async ({ data }: any) => {
        captured.form.push(data);
        return { ...data, id: NEW_FORM_ID };
      }),
    },
    formCategory: {
      create: vi.fn(async ({ data }: any) => {
        nextCategoryId += 1;
        const row = { ...data, id: 1000 + nextCategoryId };
        captured.formCategory.push(data);
        return row;
      }),
    },
    formQuestion: {
      create: vi.fn(async ({ data }: any) => {
        nextQuestionId += 1;
        const row = { ...data, id: 2000 + nextQuestionId };
        captured.formQuestion.push(row);
        return row;
      }),
    },
    radioOption: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    formQuestionCondition: { create: vi.fn().mockResolvedValue({}) },
    formMetadataField: { create: vi.fn().mockResolvedValue({}) },
    aiFormQuestionRubric: {
      findMany: vi.fn().mockResolvedValue(prevRubrics),
      create: vi.fn(async ({ data }: any) => {
        captured.rubric.push(data);
        return data;
      }),
    },
    aiFormRulePackAssignment: {
      findMany: vi.fn().mockResolvedValue(prevRulePacks),
      create: vi.fn(async ({ data }: any) => {
        captured.rulePack.push(data);
        return data;
      }),
    },
    aiCalibrationMap: {
      findMany: vi.fn().mockResolvedValue(prevCalibMaps),
      create: vi.fn(async ({ data }: any) => {
        captured.calibMap.push(data);
        return data;
      }),
    },
    aiCalibrationData: {
      findMany: vi.fn().mockResolvedValue(prevCalibData),
      create: vi.fn(async ({ data }: any) => {
        captured.calibData.push(data);
        return data;
      }),
    },
  };
}

const baseFormData: CreateFormDTO = {
  form_name: 'Contact Call Review Form (v2 AI Pilot)',
  interaction_type: 'CALL' as any,
  created_by: 1,
  // Intentionally don't override any ai_* columns — verifies they
  // all carry forward from the prior version.
  ai_enabled: true,
  categories: [
    {
      category_name: 'Greeting',
      weight: 0.5 as any,
      sort_order: 0,
      questions: [
        { question_text: 'Q1', question_type: 'YES_NO' as any, weight: 1 as any, sort_order: 0 } as any,
        { question_text: 'Q2', question_type: 'YES_NO' as any, weight: 1 as any, sort_order: 1 } as any,
      ],
    },
    {
      category_name: 'Wrap-Up',
      weight: 0.5 as any,
      sort_order: 1,
      questions: [
        { question_text: 'Q3', question_type: 'YES_NO' as any, weight: 1 as any, sort_order: 0 } as any,
      ],
    },
  ],
  metadata_fields: [],
} as any;

describe('MySQLFormRepository.updateForm — AI overlay preservation', () => {
  const repo = new MySQLFormRepository();

  beforeEach(() => {
    captured.form.length = 0;
    captured.formCategory.length = 0;
    captured.formQuestion.length = 0;
    captured.rubric.length = 0;
    captured.rulePack.length = 0;
    captured.calibMap.length = 0;
    captured.calibData.length = 0;
    nextQuestionId = 0;
    nextCategoryId = 0;

    findUniqueMock.mockReset();
    findUniqueMock.mockResolvedValue(prevFormFixture);

    transactionMock.mockReset();
    transactionMock.mockImplementation(async (fn: any) => fn(makeTx()));
  });

  it('clones prior rubrics onto new question IDs via (category_name, sort_order)', async () => {
    await repo.updateForm(PREV_FORM_ID, structuredClone(baseFormData));

    // 3 prior rubrics, all 3 questions still exist in v2 -> 3 inserts.
    expect(captured.rubric).toHaveLength(3);

    // New question IDs are assigned 2001..2003 by the stub in
    // category/question creation order. Greeting/Q1 -> 2001 maps from
    // oldQid 101; Greeting/Q2 -> 2002 from 102; Wrap-Up/Q3 -> 2003
    // from 201.
    expect(captured.rubric).toEqual([
      { form_id: NEW_FORM_ID, question_id: 2001, rubric_md: 'RUBRIC for 101', updated_by: 9 },
      { form_id: NEW_FORM_ID, question_id: 2002, rubric_md: 'RUBRIC for 102', updated_by: null },
      { form_id: NEW_FORM_ID, question_id: 2003, rubric_md: 'RUBRIC for 201', updated_by: 9 },
    ]);
  });

  it('clones rule-pack assignments + calibration map/data with rewritten form_id', async () => {
    await repo.updateForm(PREV_FORM_ID, structuredClone(baseFormData));

    expect(captured.rulePack).toEqual([
      { form_id: NEW_FORM_ID, rule_pack_id: 5, sort_order: 0, updated_by: 9 },
      { form_id: NEW_FORM_ID, rule_pack_id: 8, sort_order: 1, updated_by: null },
    ]);

    expect(captured.calibMap).toHaveLength(1);
    expect(captured.calibMap[0]).toMatchObject({
      form_id: NEW_FORM_ID,
      version: 1,
      sample_count: 50,
      is_active: true,
    });

    expect(captured.calibData).toHaveLength(1);
    expect(captured.calibData[0]).toMatchObject({
      form_id: NEW_FORM_ID,
      ticket_id: 999,
      source: 'CRM',
      source_kind: 'TICKET',
      ai_submission_id: 50,
    });
  });

  it('sets parent_form_id and inherits AI form-level columns when UI did not override them', async () => {
    await repo.updateForm(PREV_FORM_ID, structuredClone(baseFormData));

    expect(captured.form).toHaveLength(1);
    const f = captured.form[0];
    expect(f.parent_form_id).toBe(PREV_FORM_ID);
    expect(Number(f.critical_cap_percent)).toBe(60.0);
    expect(f.ai_review_guidance).toBe('<<inherited guidance>>');
    expect(f.ai_max_attached_sources).toBe(4);
    expect(f.ai_base_prompt_id).toBe(7);
    expect(f.ai_model_provider).toBe('openai');
    expect(Number(f.ai_monthly_cost_budget_usd)).toBe(500);
    expect(Number(f.ai_disagreement_route_threshold)).toBe(0.3);
    expect(Number(f.ai_sample_low_confidence_threshold)).toBe(0.55);
    expect(f.ai_calibration_auto_absorb_days).toBe(180);
  });

  it('UI override wins over inherited value', async () => {
    const overrides: any = structuredClone(baseFormData);
    overrides.critical_cap_percent = 75;
    overrides.ai_review_guidance = '<<edited in UI>>';
    overrides.ai_max_attached_sources = 1;
    overrides.ai_model_provider = 'anthropic';

    await repo.updateForm(PREV_FORM_ID, overrides);

    const f = captured.form[0];
    expect(Number(f.critical_cap_percent)).toBe(75);
    expect(f.ai_review_guidance).toBe('<<edited in UI>>');
    expect(f.ai_max_attached_sources).toBe(1);
    expect(f.ai_model_provider).toBe('anthropic');
  });

  it('does not clone rubrics for questions removed in the new version', async () => {
    // Drop Q2 (oldQid 102) from the new form payload. Greeting now has
    // only one question.
    const dto: any = structuredClone(baseFormData);
    dto.categories[0].questions = [dto.categories[0].questions[0]];

    await repo.updateForm(PREV_FORM_ID, dto);

    // Only 2 rubrics carry forward (101 and 201), 102 is dropped.
    expect(captured.rubric).toHaveLength(2);
    expect(captured.rubric.map((r) => r.rubric_md)).toEqual([
      'RUBRIC for 101',
      'RUBRIC for 201',
    ]);
  });
});
