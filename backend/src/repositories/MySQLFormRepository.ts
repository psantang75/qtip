/**
 * MySQLFormRepository - Data access layer for QA form operations using Prisma
 */

import prisma from '../config/prisma';
import { CreateFormDTO, FormWithCategories, FormCategoryWithQuestions, FormQuestion } from '../models';

const safeParam = (value: any): any => (value === undefined ? null : value);

export class MySQLFormRepository {

  constructor(_connectionPool?: any) {
    // pool parameter kept for backward compatibility
  }

  getConnection(): any {
    return prisma;
  }

  async createForm(formData: CreateFormDTO): Promise<number> {
    console.log('🚨 REPOSITORY createForm called - this is the actual code being executed!');

    const form_id = await prisma.$transaction(async (tx) => {
      await tx.form.updateMany({
        where: { form_name: formData.form_name },
        data: { is_active: false },
      });

      const form = await tx.form.create({
        data: {
          form_name: formData.form_name,
          interaction_type: formData.interaction_type as any,
          created_by: formData.created_by,
          is_active: true,
          user_version: formData.user_version ?? null,
          user_version_date: formData.user_version_date ? new Date(formData.user_version_date) : null,
        },
      });

      const questionIdMap = new Map<string, number>();

      for (let ci = 0; ci < formData.categories.length; ci++) {
        const category = formData.categories[ci];

        const cat = await tx.formCategory.create({
          data: {
            form_id: form.id,
            category_name: safeParam(category.category_name),
            description: safeParam(category.description),
            weight: safeParam(category.weight),
            sort_order: ci,
          },
        });

        for (let qi = 0; qi < category.questions.length; qi++) {
          const question = category.questions[qi];

          const q = await tx.formQuestion.create({
            data: {
              category_id: cat.id,
              question_text: safeParam(question.question_text),
              question_type: safeParam(question.question_type) as any,
              weight: safeParam(question.weight),
              sort_order: qi,
              scale_min: safeParam(question.scale_min),
              scale_max: safeParam(question.scale_max),
              is_na_allowed: safeParam(question.is_na_allowed) ?? false,
              yes_value: safeParam(question.yes_value) ?? 1,
              no_value: safeParam(question.no_value) ?? 0,
              na_value: safeParam(question.na_value) ?? 0,
              visible_to_csr: question.visible_to_csr === false ? false : true,
            },
          });

          questionIdMap.set(`${ci}-${qi}`, q.id);

          if (question.radio_options) {
            await tx.radioOption.createMany({
              data: question.radio_options.map((opt, oi) => ({
                question_id: q.id,
                option_text: safeParam(opt.option_text),
                option_value: safeParam(opt.option_value),
                score: safeParam(opt.score) ?? 0,
                has_free_text: safeParam(opt.has_free_text || false),
                sort_order: oi,
              })),
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
                    condition_type: safeParam(condition.condition_type) as any,
                    target_value: safeParam(condition.target_value),
                    logical_operator: (safeParam(condition.logical_operator) || 'AND') as any,
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
              field_name: safeParam(field.field_name),
              field_type: safeParam(field.field_type) as any,
              is_required: safeParam(field.is_required) === true,
              interaction_type: safeParam(field.interaction_type || formData.interaction_type) as any,
              dropdown_source: field.dropdown_source ?? null,
              sort_order: field.sort_order ?? 0,
            },
          });
        }
      }

      return form.id;
    });

    console.log(`✅ Form created with ID: ${form_id}`);
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
          const tq = targetCategory.questions[tqi];
          if ((tq as any).id === target_question_id) {
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
          const tq = targetCategory.questions[tqi];
          if ((tq as any).id === target_question_id) {
            return questionIdMap.get(`${tci}-${tqi}`) || target_question_id;
          }
        }
      }
    }
    return target_question_id;
  }

  async getForms(activeOnly?: boolean, page?: number, limit?: number): Promise<{ forms: FormWithCategories[]; pagination?: any }> {
    const where: any = activeOnly ? { is_active: true } : {};

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
          question_type: q.question_type as any,
          weight: Number(q.weight),
          sort_order: q.sort_order,
          scale_min: q.scale_min ?? undefined,
          scale_max: q.scale_max ?? undefined,
          is_na_allowed: q.is_na_allowed,
          yes_value: q.yes_value,
          no_value: q.no_value,
          na_value: q.na_value,
          visible_to_csr: q.visible_to_csr,
          conditions: q.conditions_source.map((c) => ({
            id: c.id,
            question_id: c.question_id,
            target_question_id: c.target_question_id,
            condition_type: c.condition_type as any,
            target_value: c.target_value ?? undefined,
            logical_operator: c.logical_operator as any,
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
          (question as any).is_conditional = true;
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
      user_version: form.user_version ?? undefined,
      user_version_date: form.user_version_date ? form.user_version_date.toISOString().split('T')[0] : undefined,
      categories: builtCategories,
      metadata_fields: metadata_fields.map((f) => ({
        id: f.id,
        form_id: f.form_id,
        field_name: f.field_name,
        field_type: f.field_type as any,
        is_required: f.is_required,
        interaction_type: f.interaction_type as any,
        dropdown_source: f.dropdown_source ?? undefined,
        sort_order: f.sort_order,
        created_at: f.created_at,
      })),
    };
  }

  async updateForm(form_id: number, formData: CreateFormDTO): Promise<number> {
    console.log('🚨 REPOSITORY updateForm called - creating new version!');

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
          interaction_type: formData.interaction_type as any,
          version: newVersion,
          created_by: formData.created_by,
          is_active: true,
          user_version: formData.user_version ?? null,
          user_version_date: formData.user_version_date ? new Date(formData.user_version_date) : null,
        },
      });

      const questionIdMap = new Map<string, number>();

      for (let ci = 0; ci < formData.categories.length; ci++) {
        const category = formData.categories[ci];

        const cat = await tx.formCategory.create({
          data: {
            form_id: form.id,
            category_name: safeParam(category.category_name),
            description: safeParam(category.description),
            weight: safeParam(category.weight),
            sort_order: ci,
          },
        });

        for (let qi = 0; qi < category.questions.length; qi++) {
          const question = category.questions[qi];

          const q = await tx.formQuestion.create({
            data: {
              category_id: cat.id,
              question_text: safeParam(question.question_text),
              question_type: safeParam(question.question_type) as any,
              weight: safeParam(question.weight),
              sort_order: qi,
              scale_min: safeParam(question.scale_min),
              scale_max: safeParam(question.scale_max),
              is_na_allowed: safeParam(question.is_na_allowed) ?? false,
              yes_value: safeParam(question.yes_value) ?? 1,
              no_value: safeParam(question.no_value) ?? 0,
              na_value: safeParam(question.na_value) ?? 0,
              visible_to_csr: question.visible_to_csr === false ? false : true,
            },
          });

          questionIdMap.set(`${ci}-${qi}`, q.id);

          if (question.radio_options) {
            await tx.radioOption.createMany({
              data: question.radio_options.map((opt, oi) => ({
                question_id: q.id,
                option_text: safeParam(opt.option_text),
                option_value: safeParam(opt.option_value),
                score: safeParam(opt.score) ?? 0,
                has_free_text: safeParam(opt.has_free_text || false),
                sort_order: oi,
              })),
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
                    condition_type: safeParam(condition.condition_type) as any,
                    target_value: safeParam(condition.target_value),
                    logical_operator: (safeParam(condition.logical_operator) || 'AND') as any,
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
              field_name: safeParam(field.field_name),
              field_type: safeParam(field.field_type) as any,
              is_required: safeParam(field.is_required) === true,
              interaction_type: safeParam(field.interaction_type || formData.interaction_type) as any,
              dropdown_source: field.dropdown_source ?? null,
              sort_order: field.sort_order ?? 0,
            },
          });
        }
      }

      return form.id;
    });

    console.log(`✅ New form created with ID: ${newFormId}, version: ${newVersion}`);
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

      console.log('[FORM REPOSITORY] Form deactivated successfully');
    } catch (error) {
      console.error('[FORM REPOSITORY] Error in deactivateForm:', error);
      throw error;
    }
  }
}
