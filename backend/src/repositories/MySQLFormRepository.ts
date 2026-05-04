/**
 * MySQLFormRepository - Data access layer for QA form operations using Prisma
 */

import prisma from '../config/prisma';
import { CreateFormDTO, FormWithCategories, FormCategoryWithQuestions, FormQuestion, QuestionType, condition_type, logical_operator, MetadataFieldType, interaction_type } from '../models';
import type {
  FormInteractionType, FormQuestionType, FormMetadataFieldType,
  FormMetadataInteractionType, FormQuestionConditionType, FormQuestionLogicalOperator,
  Prisma,
} from '../generated/prisma/client';
import logger from '../config/logger';

const safeParam = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

/** Canonical title for the auto-managed AI Reviewer feedback question. */
export const AI_REVIEWER_FEEDBACK_QUESTION_TEXT = 'AI Reviewer Feedback';
/** Canonical category name that wraps the auto-managed AI Reviewer feedback question. */
export const AI_REVIEWER_CATEGORY_NAME = 'AI Reviewer';

/**
 * When `formData.ai_enabled` is true and the payload doesn't already include
 * an AI-Reviewer-Feedback question, append a dedicated category with a single
 * free-text question for the AI's narrative output. Mutates the passed-in
 * formData in place so it flows through the existing persistence path
 * unchanged. Idempotent: a second call is a no-op.
 *
 * Uses weight = 0 so the auto-added category does not disturb the existing
 * "category weights must sum to 1.0" validation. The free-text question is
 * unscored (weight 0) for the same reason.
 */
/**
 * Trims AI-reviewer guidance and forces it back to NULL when the AI feature
 * is off, so a stale value can't accidentally influence a future enable.
 */
export function normalizeGuidance(guidance: string | null | undefined, aiEnabled: boolean): string | null {
  if (!aiEnabled) return null;
  const trimmed = (guidance ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Clamps the per-form Trusted-mode sample percentage to 0-100 and falls
 * back to the column default (10) when the input is missing or invalid.
 * Returns 0 when the AI feature is off so the column reflects "irrelevant".
 */
export function normalizeSamplePct(pct: number | null | undefined, aiEnabled: boolean): number {
  if (!aiEnabled) return 0;
  if (pct == null || !Number.isFinite(pct)) return 10;
  const n = Math.round(pct);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function ensureAiReviewerFeedbackQuestion(formData: CreateFormDTO): void {
  if (!formData.ai_enabled) return;
  const alreadyHas = formData.categories.some((c) =>
    c.questions.some((q) => q.question_text?.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT),
  );
  if (alreadyHas) return;
  formData.categories.push({
    category_name: AI_REVIEWER_CATEGORY_NAME,
    description: 'Auto-managed by the AI Reviewer feature. Holds the AI-generated narrative feedback for each AI-graded submission.',
    weight: 0,
    sort_order: formData.categories.length,
    questions: [
      {
        question_text: AI_REVIEWER_FEEDBACK_QUESTION_TEXT,
        question_type: 'TEXT',
        weight: 0,
        sort_order: 0,
        is_na_allowed: false,
        visible_to_csr: true,
        is_critical: false,
      },
    ],
  });
}

export class MySQLFormRepository {

  constructor(_connectionPool?: any) {
    // pool parameter kept for backward compatibility
  }

  getConnection(): any {
    return prisma;
  }

  async createForm(formData: CreateFormDTO): Promise<number> {
    logger.info('🚨 REPOSITORY createForm called - this is the actual code being executed!');

    ensureAiReviewerFeedbackQuestion(formData);

    const form_id = await prisma.$transaction(async (tx) => {
      await tx.form.updateMany({
        where: { form_name: formData.form_name },
        data: { is_active: false },
      });

      const form = await tx.form.create({
        data: {
          form_name: formData.form_name,
          interaction_type: formData.interaction_type as FormInteractionType,
          created_by: formData.created_by,
          is_active: formData.is_active !== undefined ? formData.is_active : true,
          user_version: formData.user_version ?? null,
          user_version_date: formData.user_version_date ? new Date(formData.user_version_date) : null,
          critical_cap_percent: (formData.critical_cap_percent ?? 79.0) as any,
          ai_enabled: formData.ai_enabled === true,
          ai_review_guidance: normalizeGuidance(formData.ai_review_guidance, formData.ai_enabled === true),
          ai_submit_as_draft: formData.ai_enabled === true && formData.ai_submit_as_draft === true,
          ai_sample_review_pct: normalizeSamplePct(formData.ai_sample_review_pct, formData.ai_enabled === true),
          ai_sample_low_score_always: formData.ai_enabled === true ? formData.ai_sample_low_score_always !== false : false,
        },
      });

      const questionIdMap = new Map<string, number>();

      for (let ci = 0; ci < formData.categories.length; ci++) {
        const category = formData.categories[ci];

        const cat = await tx.formCategory.create({
          data: {
            form_id: form.id,
            category_name: safeParam(category.category_name) as string,
            description: safeParam(category.description),
            weight: safeParam(category.weight) as any,
            sort_order: ci,
          },
        });

        for (let qi = 0; qi < category.questions.length; qi++) {
          const question = category.questions[qi];

          const q = await tx.formQuestion.create({
            data: {
              category_id: cat.id,
              question_text: safeParam(question.question_text) as string,
              question_type: question.question_type as FormQuestionType,
              weight: safeParam(question.weight) as any,
              sort_order: qi,
              scale_min: safeParam(question.scale_min) as any,
              scale_max: safeParam(question.scale_max) as any,
              is_na_allowed: safeParam(question.is_na_allowed) ?? false,
              yes_value: safeParam(question.yes_value) ?? 1,
              no_value: safeParam(question.no_value) ?? 0,
              na_value: safeParam(question.na_value) ?? 0,
              visible_to_csr: question.visible_to_csr === false ? false : true,
              is_critical: question.is_critical === true,
            },
          });

          questionIdMap.set(`${ci}-${qi}`, q.id);

          if (question.radio_options) {
            await tx.radioOption.createMany({
              data: question.radio_options.map((opt, oi) => ({
                question_id: q.id,
                option_text: safeParam(opt.option_text) as string,
                option_value: safeParam(opt.option_value) as string,
                score: safeParam(opt.score) ?? 0,
                has_free_text: safeParam(opt.has_free_text || false) as any,
                sort_order: oi,
              })) as any,
            });
          }

          if (question.conditions) {
            for (let condIdx = 0; condIdx < question.conditions.length; condIdx++) {
              const condition = question.conditions[condIdx];
              let target_question_id = condition.target_question_id;

              target_question_id = this.resolveTargetQuestionId(
                target_question_id, formData, ci, qi, questionIdMap, condIdx
              );

              if (target_question_id && target_question_id > 0) {
                await tx.formQuestionCondition.create({
                  data: {
                    question_id: q.id,
                    target_question_id: target_question_id,
                    condition_type: condition.condition_type as FormQuestionConditionType,
                    target_value: safeParam(condition.target_value),
                    logical_operator: (condition.logical_operator ?? 'AND') as FormQuestionLogicalOperator,
                    group_id: safeParam(condition.group_id) ?? 0,
                    sort_order: safeParam(condition.sort_order) ?? condIdx,
                  },
                });
              }
            }
          }
        }
      }

      if (formData.metadata_fields && formData.metadata_fields.length > 0) {
        let spacerCount = 0;
        for (const field of formData.metadata_fields) {
          if (field.field_type === 'SPACER') {
            spacerCount++;
            field.field_name = `Spacer-${spacerCount}`;
          }
          await tx.formMetadataField.create({
            data: {
              form_id: form.id,
              field_name: safeParam(field.field_name) as string,
              field_type: field.field_type as FormMetadataFieldType,
              is_required: safeParam(field.is_required) === true,
              interaction_type: (field.interaction_type || formData.interaction_type) as FormMetadataInteractionType,
              dropdown_source: field.dropdown_source ?? null,
              sort_order: field.sort_order ?? 0,
            },
          });
        }
      }

      return form.id;
    });

    logger.info(`✅ Form created with ID: ${form_id}`);
    return form_id;
  }

  private resolveTargetQuestionId(
    target_question_id: number,
    formData: CreateFormDTO,
    currentCategoryIndex: number,
    currentQuestionIndex: number,
    questionIdMap: Map<string, number>,
    condIdx: number
  ): number {
    if (target_question_id < 0) {
      for (let tci = 0; tci < formData.categories.length; tci++) {
        const targetCategory = formData.categories[tci];
        for (let tqi = 0; tqi < targetCategory.questions.length; tqi++) {
          const tq = targetCategory.questions[tqi] as any;
          if (tq.id === target_question_id) {
            return questionIdMap.get(`${tci}-${tqi}`) || target_question_id;
          }
        }
      }
      if (target_question_id === -1 && currentQuestionIndex > 0) {
        return questionIdMap.get(`${currentCategoryIndex}-${currentQuestionIndex - 1}`) || target_question_id;
      }
    } else {
      for (let tci = 0; tci < formData.categories.length; tci++) {
        const targetCategory = formData.categories[tci];
        for (let tqi = 0; tqi < targetCategory.questions.length; tqi++) {
          const tq = targetCategory.questions[tqi] as any;
          if (tq.id === target_question_id) {
            return questionIdMap.get(`${tci}-${tqi}`) || target_question_id;
          }
        }
      }
    }
    return target_question_id;
  }

  async getForms(isActive?: boolean, page?: number, limit?: number): Promise<{ forms: FormWithCategories[]; pagination?: any }> {
    // isActive === true  → only active forms
    // isActive === false → only inactive forms
    // isActive === undefined → all forms
    const where: Prisma.FormWhereInput = isActive === true ? { is_active: true } : isActive === false ? { is_active: false } : {};

    const take = limit ? Math.min(Math.max(parseInt(String(limit)) || 50, 1), 1000) : undefined;
    const skip = page && take ? (Math.max(parseInt(String(page)) || 1, 1) - 1) * take : undefined;

    const rows = await prisma.form.findMany({
      where,
      include: { creator: { select: { username: true } } },
      orderBy: { created_at: 'desc' },
      take,
      skip,
    });

    const forms = rows.map((row) => ({
      id: row.id,
      form_name: row.form_name,
      interaction_type: row.interaction_type,
      version: row.version || 1,
      created_by: row.created_by,
      created_at: row.created_at,
      is_active: row.is_active,
      ai_enabled: (row as any).ai_enabled === true,
      ai_review_guidance: ((row as any).ai_review_guidance ?? null) as string | null,
      ai_submit_as_draft: (row as any).ai_submit_as_draft === true,
      ai_sample_review_pct: Number((row as any).ai_sample_review_pct ?? 10),
      ai_sample_low_score_always: (row as any).ai_sample_low_score_always === true,
      categories: [],
    })) as FormWithCategories[];

    return { forms };
  }

  async getFormById(form_id: number, includeInactive = false): Promise<FormWithCategories | null> {
    const form = await prisma.form.findFirst({
      where: { id: form_id, ...(includeInactive ? {} : { is_active: true }) },
      include: { creator: { select: { username: true } } },
    });

    if (!form) return null;

    const categories = await prisma.formCategory.findMany({
      where: { form_id: form_id },
      include: {
        form_questions: {
          orderBy: { sort_order: 'asc' },
          include: {
            conditions_source: { orderBy: [{ group_id: 'asc' }, { sort_order: 'asc' }] },
            radio_options: { orderBy: { id: 'asc' }, where: {} },
          },
        },
      },
      orderBy: { sort_order: 'asc' },
    });

    const builtCategories: FormCategoryWithQuestions[] = categories.map((cat) => ({
      id: cat.id,
      form_id: cat.form_id,
      category_name: cat.category_name,
      description: cat.description ?? undefined,
      weight: Number(cat.weight),
      sort_order: cat.sort_order,
      questions: cat.form_questions.map((q) => {
        const question: FormQuestion = {
          id: q.id,
          category_id: q.category_id,
          question_text: q.question_text,
          question_type: q.question_type as unknown as QuestionType,
          weight: Number(q.weight),
          sort_order: q.sort_order,
          scale_min: q.scale_min ?? undefined,
          scale_max: q.scale_max ?? undefined,
          is_na_allowed: q.is_na_allowed,
          yes_value: q.yes_value,
          no_value: q.no_value,
          na_value: q.na_value,
          visible_to_csr: q.visible_to_csr,
          is_critical: (q as any).is_critical ?? false,
          conditions: q.conditions_source.map((c) => ({
            id: c.id,
            question_id: c.question_id,
            target_question_id: c.target_question_id,
            condition_type: c.condition_type as unknown as condition_type,
            target_value: c.target_value ?? undefined,
            logical_operator: c.logical_operator as unknown as logical_operator,
            group_id: c.group_id,
            sort_order: c.sort_order,
            created_at: c.created_at,
          })),
          radio_options: q.radio_options.map((r) => ({
            id: r.id,
            question_id: r.question_id,
            option_text: r.option_text,
            option_value: r.option_value,
            score: r.score,
            has_free_text: r.has_free_text,
            created_at: r.created_at,
            updated_at: r.updated_at,
          })),
        };
        if (question.conditions && question.conditions.length > 0) {
          question.is_conditional = true;
        }
        return question;
      }),
    }));

    const metadata_fields = await prisma.formMetadataField.findMany({
      where: { form_id: form_id },
      orderBy: { sort_order: 'asc' },
    });

    return {
      id: form.id,
      form_name: form.form_name,
      interaction_type: form.interaction_type,
      version: form.version || 1,
      created_by: form.created_by,
      created_at: form.created_at,
      is_active: form.is_active,
      ai_enabled: (form as any).ai_enabled === true,
      ai_review_guidance: ((form as any).ai_review_guidance ?? null) as string | null,
      ai_submit_as_draft: (form as any).ai_submit_as_draft === true,
      ai_sample_review_pct: Number((form as any).ai_sample_review_pct ?? 10),
      ai_sample_low_score_always: (form as any).ai_sample_low_score_always === true,
      user_version: form.user_version ?? undefined,
      user_version_date: form.user_version_date ? form.user_version_date.toISOString().split('T')[0] : undefined,
      critical_cap_percent: (form as any).critical_cap_percent !== undefined && (form as any).critical_cap_percent !== null
        ? Number((form as any).critical_cap_percent)
        : 79.0,
      categories: builtCategories,
      metadata_fields: metadata_fields.map((f) => ({
        id: f.id,
        form_id: f.form_id,
        field_name: f.field_name,
        field_type: f.field_type as unknown as MetadataFieldType,
        is_required: f.is_required,
        interaction_type: f.interaction_type as unknown as interaction_type,
        dropdown_source: f.dropdown_source ?? undefined,
        sort_order: f.sort_order,
        created_at: f.created_at,
      })),
    };
  }

  async updateForm(form_id: number, formData: CreateFormDTO): Promise<number> {
    logger.info('🚨 REPOSITORY updateForm called - creating new version!');

    ensureAiReviewerFeedbackQuestion(formData);

    const currentForm = await prisma.form.findUnique({
      where: { id: form_id },
      select: { form_name: true, version: true },
    });

    const currentFormName = currentForm?.form_name || formData.form_name;
    const newVersion = (currentForm?.version || 1) + 1;

    const newFormId = await prisma.$transaction(async (tx) => {
      await tx.form.updateMany({
        where: { form_name: currentFormName },
        data: { is_active: false },
      });

      const form = await tx.form.create({
        data: {
          form_name: formData.form_name,
          interaction_type: formData.interaction_type as FormInteractionType,
          version: newVersion,
          created_by: formData.created_by,
          is_active: formData.is_active !== undefined ? formData.is_active : true,
          user_version: formData.user_version ?? null,
          user_version_date: formData.user_version_date ? new Date(formData.user_version_date) : null,
          critical_cap_percent: (formData.critical_cap_percent ?? 79.0) as any,
          ai_enabled: formData.ai_enabled === true,
          ai_review_guidance: normalizeGuidance(formData.ai_review_guidance, formData.ai_enabled === true),
          ai_submit_as_draft: formData.ai_enabled === true && formData.ai_submit_as_draft === true,
          ai_sample_review_pct: normalizeSamplePct(formData.ai_sample_review_pct, formData.ai_enabled === true),
          ai_sample_low_score_always: formData.ai_enabled === true ? formData.ai_sample_low_score_always !== false : false,
        },
      });

      const questionIdMap = new Map<string, number>();

      for (let ci = 0; ci < formData.categories.length; ci++) {
        const category = formData.categories[ci];

        const cat = await tx.formCategory.create({
          data: {
            form_id: form.id,
            category_name: safeParam(category.category_name) as string,
            description: safeParam(category.description),
            weight: safeParam(category.weight) as any,
            sort_order: ci,
          },
        });

        for (let qi = 0; qi < category.questions.length; qi++) {
          const question = category.questions[qi];

          const q = await tx.formQuestion.create({
            data: {
              category_id: cat.id,
              question_text: safeParam(question.question_text) as string,
              question_type: question.question_type as FormQuestionType,
              weight: safeParam(question.weight) as any,
              sort_order: qi,
              scale_min: safeParam(question.scale_min) as any,
              scale_max: safeParam(question.scale_max) as any,
              is_na_allowed: safeParam(question.is_na_allowed) ?? false,
              yes_value: safeParam(question.yes_value) ?? 1,
              no_value: safeParam(question.no_value) ?? 0,
              na_value: safeParam(question.na_value) ?? 0,
              visible_to_csr: question.visible_to_csr === false ? false : true,
              is_critical: question.is_critical === true,
            },
          });

          questionIdMap.set(`${ci}-${qi}`, q.id);

          if (question.radio_options) {
            await tx.radioOption.createMany({
              data: question.radio_options.map((opt, oi) => ({
                question_id: q.id,
                option_text: safeParam(opt.option_text) as string,
                option_value: safeParam(opt.option_value) as string,
                score: safeParam(opt.score) ?? 0,
                has_free_text: safeParam(opt.has_free_text || false) as any,
                sort_order: oi,
              })) as any,
            });
          }

          if (question.conditions) {
            for (let condIdx = 0; condIdx < question.conditions.length; condIdx++) {
              const condition = question.conditions[condIdx];
              let target_question_id = condition.target_question_id;

              target_question_id = this.resolveTargetQuestionId(
                target_question_id, formData, ci, qi, questionIdMap, condIdx
              );

              if (target_question_id && target_question_id > 0) {
                await tx.formQuestionCondition.create({
                  data: {
                    question_id: q.id,
                    target_question_id: target_question_id,
                    condition_type: condition.condition_type as FormQuestionConditionType,
                    target_value: safeParam(condition.target_value),
                    logical_operator: (condition.logical_operator ?? 'AND') as FormQuestionLogicalOperator,
                    group_id: safeParam(condition.group_id) ?? 0,
                    sort_order: safeParam(condition.sort_order) ?? condIdx,
                  },
                });
              }
            }
          }
        }
      }

      if (formData.metadata_fields && formData.metadata_fields.length > 0) {
        let spacerCount = 0;
        for (const field of formData.metadata_fields) {
          if (field.field_type === 'SPACER') {
            spacerCount++;
            field.field_name = `Spacer-${spacerCount}`;
          }
          await tx.formMetadataField.create({
            data: {
              form_id: form.id,
              field_name: safeParam(field.field_name) as string,
              field_type: field.field_type as FormMetadataFieldType,
              is_required: safeParam(field.is_required) === true,
              interaction_type: (field.interaction_type || formData.interaction_type) as FormMetadataInteractionType,
              dropdown_source: field.dropdown_source ?? null,
              sort_order: field.sort_order ?? 0,
            },
          });
        }
      }

      return form.id;
    });

    logger.info(`✅ New form created with ID: ${newFormId}, version: ${newVersion}`);
    return newFormId;
  }

  async deactivateForm(form_id: number, _updatedBy: number): Promise<void> {
    try {
      const result = await prisma.form.updateMany({
        where: { id: form_id },
        data: { is_active: false },
      });

      if (result.count === 0) {
        throw new Error(`No form found with ID ${form_id} to deactivate`);
      }

      logger.info('[FORM REPOSITORY] Form deactivated successfully');
    } catch (error) {
      logger.error('[FORM REPOSITORY] Error in deactivateForm:', error);
      throw error;
    }
  }
}
