/**
 * MySQLFormRepository - Data access layer for QA form operations using Prisma
 */

import prisma from '../config/prisma';
import { CreateFormDTO, FormWithCategories, FormCategoryWithQuestions, FormQuestion, QuestionType, condition_type, logical_operator, MetadataFieldType, interaction_type, FormQuestionRole, FormRollupRule } from '../models';
import type {
  FormInteractionType, FormQuestionType, FormMetadataFieldType,
  FormMetadataInteractionType, FormQuestionConditionType, FormQuestionLogicalOperator,
  Prisma,
} from '../generated/prisma/client';
import logger from '../config/logger';
import { INTERNAL_MODE, parseAccessRoles, parseAccessUsers, userToken, normalizeRole, canAccessInternalFormCurrent } from '../utils/formScope';

const safeParam = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

/**
 * Sanitize the Internal-mode fields for persistence. When the form is in
 * Internal mode we store `access_mode='INTERNAL'` and a single validated
 * audience array in `access_roles` that packs both role keys AND individual-user
 * tokens (`user:<id>`); otherwise both are cleared (undefined leaves the JSON
 * column NULL on the freshly-created version row). Single source of truth for
 * what lands in the DB from the create/update payloads.
 */
function buildInternalFieldData(formData: CreateFormDTO): { access_mode: string | null; access_roles?: string[] } {
  if (formData.access_mode === INTERNAL_MODE) {
    // 'admin' is implicit; drop it from storage to keep the list canonical.
    const roles = parseAccessRoles(formData.access_roles).filter((r) => r !== 'admin');
    const userIds = parseAccessUsers((formData as { access_users?: unknown }).access_users);
    const audience = Array.from(new Set([...roles, ...userIds.map(userToken)]));
    return { access_mode: INTERNAL_MODE, access_roles: audience };
  }
  return { access_mode: null, access_roles: undefined };
}

/** Canonical title for the auto-managed AI Reviewer feedback question. */
export const AI_REVIEWER_FEEDBACK_QUESTION_TEXT = 'AI Reviewer Feedback';
/** Canonical category name that wraps the auto-managed AI Reviewer feedback question. */
export const AI_REVIEWER_CATEGORY_NAME = 'AI Reviewer';
/**
 * Regex matching the per-category Feedback TEXT question convention used
 * across form authoring (e.g. "Feedback — Greeting / Verification"). The
 * AI Reviewer's per-category notes are routed into the TEXT question on
 * a category whose `question_text` starts with this prefix. We tolerate
 * both the em-dash (canonical seed style) and the ASCII hyphen so legacy
 * seeds and hand-typed forms both match.
 */
export const CATEGORY_FEEDBACK_TEXT_PREFIX_RE = /^feedback\s*[\u2014-]\s*/i;
/**
 * Prefix prepended to every AI-injected per-category Feedback answer so
 * the human reviewer can see at a glance that the text was written by
 * the AI Reviewer (versus a human auditor who edited it afterward). The
 * frontend may also use this prefix to detect / strip AI-authored
 * content in future iterations.
 */
export const AI_REVIEW_NOTES_PREFIX = 'AI Review Notes - ';

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
          ...buildInternalFieldData(formData),
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

      // A brand-new form starts its own version family: the group id is its own
      // row id (auto-increment, so only known after the insert). Every later
      // version inherits this value in updateForm().
      await tx.form.update({ where: { id: form.id }, data: { form_group_id: form.id } });

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
              role: (question.role ?? 'DETAIL') as any,
              rollup_rule: (question.rollup_rule ?? null) as any,
              // rollup_member_question_ids is set in a second pass below
              // because the members may reference questions that have not
              // yet been created in this transaction (rollups commonly
              // sit at sort_order 0 and reference siblings at 1..N).
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

      // Second pass: resolve rollup member IDs now that every question
      // in this form has been created and has a known new ID in
      // questionIdMap. See resolveRollupMemberIds() for the rationale.
      for (let ci = 0; ci < formData.categories.length; ci++) {
        const category = formData.categories[ci];
        for (let qi = 0; qi < category.questions.length; qi++) {
          const question = category.questions[qi];
          if (question.role !== 'ROLLUP') continue;
          const newQid = questionIdMap.get(`${ci}-${qi}`);
          if (newQid === undefined) continue;
          const resolved = this.resolveRollupMemberIds(
            question.rollup_member_question_ids,
            formData,
            questionIdMap,
          );
          await tx.formQuestion.update({
            where: { id: newQid },
            data: { rollup_member_question_ids: resolved as any },
          });
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

  /**
   * Coerces the JSON column value back into `number[] | null`. Prisma
   * surfaces JSON columns as `Prisma.JsonValue` which TS can't narrow on
   * its own; we accept either `null`, an array of numbers, or any other
   * shape (silently dropped). Used only on the read path.
   */
  private normalizeRollupMembers(value: unknown): number[] | null {
    if (value == null) return null;
    if (!Array.isArray(value)) return null;
    const ids = value
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids : null;
  }

  /**
   * Translates the client-supplied `rollup_member_question_ids` (which can
   * hold either negative temp IDs for brand-new questions or old positive
   * IDs from a prior save) into the canonical new IDs created in this
   * transaction. Runs as a SECOND pass after every question in the form
   * has been created, because rollups commonly reference siblings that
   * sit later in the same category and whose new IDs do not yet exist
   * during the first create pass.
   *
   * Returns `null` when the input is empty or every member fails to
   * resolve, so the column stores NULL instead of `[]` (keeps the engine's
   * "no members configured" branch consistent).
   */
  private resolveRollupMemberIds(
    memberIds: number[] | null | undefined,
    formData: CreateFormDTO,
    questionIdMap: Map<string, number>,
  ): number[] | null {
    if (!memberIds || memberIds.length === 0) return null;
    const resolved: number[] = [];
    for (const oldId of memberIds) {
      let newId: number | undefined;
      for (let tci = 0; tci < formData.categories.length; tci++) {
        const targetCategory = formData.categories[tci];
        for (let tqi = 0; tqi < targetCategory.questions.length; tqi++) {
          const tq = targetCategory.questions[tqi] as any;
          if (tq.id === oldId) {
            newId = questionIdMap.get(`${tci}-${tqi}`);
            break;
          }
        }
        if (newId !== undefined) break;
      }
      if (newId === undefined && oldId > 0) {
        // Already a positive ID and not found in the formData payload -
        // the client may have sent the new ID directly (e.g. on a re-save
        // after a previous round-trip). Trust it as-is.
        newId = oldId;
      }
      if (newId !== undefined && newId > 0) resolved.push(newId);
    }
    return resolved.length > 0 ? resolved : null;
  }

  private resolveTargetQuestionId(
    target_question_id: number,
    formData: CreateFormDTO,
    currentCategoryIndex: number,
    currentQuestionIndex: number,
    questionIdMap: Map<string, number>,
    _condIdx: number
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

  async getForms(isActive?: boolean, page?: number, limit?: number, role?: string, userId?: number): Promise<{ forms: FormWithCategories[]; pagination?: any }> {
    // isActive === true  → only active forms
    // isActive === false → only inactive forms
    // isActive === undefined → all forms
    const activeWhere: Prisma.FormWhereInput = isActive === true ? { is_active: true } : isActive === false ? { is_active: false } : {};

    // Internal-mode scope: normal forms are visible to everyone; Internal forms
    // only to their configured audience — either by role OR by an individual-user
    // grant (admin always). A missing role sees normal forms only — Internal
    // forms never leak into an unscoped picker.
    //
    // The audience is matched ONLY against the ACTIVE version of an Internal
    // form. Superseded versions keep their OLD access_roles, so without the
    // is_active guard a grant removed on the new version would still match a
    // stale row and leak the form back into the picker. This mirrors the
    // current-governance rule in resolvePermittedInternalForms.
    const roleKey = normalizeRole(role);
    const internalAudienceOr: Prisma.FormWhereInput[] = [
      { access_mode: INTERNAL_MODE, is_active: true, access_roles: { array_contains: roleKey } },
    ];
    if (userId != null) {
      internalAudienceOr.push({ access_mode: INTERNAL_MODE, is_active: true, access_roles: { array_contains: userToken(userId) } });
    }
    const accessWhere: Prisma.FormWhereInput =
      roleKey === 'admin'
        ? {}
        : { OR: [{ access_mode: null }, ...internalAudienceOr] };

    const where: Prisma.FormWhereInput = { AND: [activeWhere, accessWhere] };

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
      form_group_id: ((row as any).form_group_id ?? null) as number | null,
      access_mode: ((row as any).access_mode ?? null) as string | null,
      access_roles: parseAccessRoles((row as any).access_roles),
      access_users: parseAccessUsers((row as any).access_roles),
      ai_enabled: (row as any).ai_enabled === true,
      ai_review_guidance: ((row as any).ai_review_guidance ?? null) as string | null,
      ai_submit_as_draft: (row as any).ai_submit_as_draft === true,
      ai_sample_review_pct: Number((row as any).ai_sample_review_pct ?? 10),
      ai_sample_low_score_always: (row as any).ai_sample_low_score_always === true,
      categories: [],
    })) as FormWithCategories[];

    return { forms };
  }

  async getFormById(
    form_id: number,
    includeInactive = false,
    requesterRole?: string,
    requesterUserId?: number,
  ): Promise<FormWithCategories | null> {
    const form = await prisma.form.findFirst({
      where: { id: form_id, ...(includeInactive ? {} : { is_active: true }) },
      include: { creator: { select: { username: true } } },
    });

    if (!form) return null;

    // Internal-mode forms are audience-gated: a requester outside the audience
    // must not be able to load the form by ID — hiding the form itself, not just
    // its results. Treated as "not found" so we never reveal that a hidden
    // research form exists. Internal service calls (update/deactivate) pass no
    // requester context and are unaffected — they are already gated by the
    // `quality_forms` edit permission.
    if (
      requesterRole !== undefined &&
      !(await canAccessInternalFormCurrent(requesterRole, form, requesterUserId ?? null))
    ) {
      return null;
    }

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
          role: ((q as any).role ?? 'DETAIL') as FormQuestionRole,
          rollup_rule: ((q as any).rollup_rule ?? null) as FormRollupRule | null,
          rollup_member_question_ids: this.normalizeRollupMembers((q as any).rollup_member_question_ids),
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
      form_group_id: ((form as any).form_group_id ?? null) as number | null,
      access_mode: ((form as any).access_mode ?? null) as string | null,
      access_roles: parseAccessRoles((form as any).access_roles),
      access_users: parseAccessUsers((form as any).access_roles),
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

    // Load the previous version's full row + categories/questions so we can
    // 1) inherit AI form-level columns when the UI didn't override them and
    // 2) build a (category_name, sort_order) -> oldQuestionId map for
    // cloning per-question artifacts (rubrics) onto the new form.
    const currentForm = await prisma.form.findUnique({
      where: { id: form_id },
      include: {
        form_categories: {
          include: { form_questions: true },
        },
      },
    });

    const currentFormName = currentForm?.form_name || formData.form_name;
    const newVersion = (currentForm?.version || 1) + 1;

    // (category_name -> (sort_order -> oldQuestionId)) for cross-version
    // question matching. Question IDs are auto-increment per row so we
    // can't carry them; the structural key is the only stable join.
    const oldQidByCatSort = new Map<string, Map<number, number>>();
    if (currentForm) {
      for (const cat of currentForm.form_categories) {
        const inner = new Map<number, number>();
        for (const q of cat.form_questions) inner.set(q.sort_order, q.id);
        oldQidByCatSort.set(cat.category_name, inner);
      }
    }

    const newAiEnabled =
      formData.ai_enabled !== undefined
        ? formData.ai_enabled === true
        : ((currentForm as any)?.ai_enabled === true);

    // Internal-mode inheritance: an explicit access_mode in the payload wins;
    // otherwise carry the prior version's mode/audience forward so editing an
    // Internal form's other settings keeps it an Internal form.
    const internalFieldData = buildInternalFieldData(
      formData.access_mode !== undefined
        ? formData
        : ({
            access_mode: (currentForm as any)?.access_mode ?? null,
            access_roles: parseAccessRoles((currentForm as any)?.access_roles),
            access_users: parseAccessUsers((currentForm as any)?.access_roles),
          } as CreateFormDTO),
    );

    // Version-family identity: the new version inherits the family's
    // form_group_id so all versions share one stable id even across renames.
    // Fall back to the prior row's own id for any legacy row that predates the
    // backfill (form_group_id NULL); a truly missing currentForm leaves it null
    // and the new row seeds its own group below.
    const groupId: number | null =
      (currentForm as any)?.form_group_id ?? (currentForm as any)?.id ?? null;

    const newFormId = await prisma.$transaction(async (tx) => {
      // Deactivate every prior version of THIS family by its stable group id,
      // not by form_name (a renamed version would otherwise be missed, leaving
      // two active versions).
      await tx.form.updateMany({
        where: groupId != null ? { form_group_id: groupId } : { form_name: currentFormName },
        data: { is_active: false },
      });

      const form = await tx.form.create({
        data: {
          form_name: formData.form_name,
          interaction_type: formData.interaction_type as FormInteractionType,
          version: newVersion,
          created_by: formData.created_by,
          is_active: formData.is_active !== undefined ? formData.is_active : true,
          ...internalFieldData,
          // Versioning lineage: every new save points back to the form it
          // superseded so we can walk parent_form_id to recover prior
          // rubrics/calibration history if a future bug orphans rows again.
          parent_form_id: form_id,
          // Stable family id shared by every version (see schema doc). Left
          // undefined only when the prior row had none; seeded to self below.
          form_group_id: groupId ?? undefined,
          user_version: formData.user_version ?? null,
          user_version_date: formData.user_version_date ? new Date(formData.user_version_date) : null,
          // Inheritance rule for every AI form-level column: UI override
          // wins, otherwise carry forward the previous version's value,
          // otherwise fall back to the schema default. Prevents silent
          // resets (e.g. critical_cap_percent reverting to 79 on every
          // save when the form actually runs at 60).
          critical_cap_percent: (formData.critical_cap_percent
            ?? (currentForm as any)?.critical_cap_percent
            ?? 79.0) as any,
          ai_enabled: newAiEnabled,
          ai_review_guidance: normalizeGuidance(
            formData.ai_review_guidance !== undefined
              ? formData.ai_review_guidance
              : (currentForm as any)?.ai_review_guidance,
            newAiEnabled,
          ),
          ai_submit_as_draft: newAiEnabled && (
            formData.ai_submit_as_draft !== undefined
              ? formData.ai_submit_as_draft === true
              : (currentForm as any)?.ai_submit_as_draft === true
          ),
          ai_sample_review_pct: normalizeSamplePct(
            formData.ai_sample_review_pct !== undefined
              ? formData.ai_sample_review_pct
              : (currentForm as any)?.ai_sample_review_pct,
            newAiEnabled,
          ),
          ai_sample_low_score_always: newAiEnabled
            ? (formData.ai_sample_low_score_always !== undefined
                ? formData.ai_sample_low_score_always !== false
                : (currentForm as any)?.ai_sample_low_score_always !== false)
            : false,
          ai_sample_low_confidence_threshold:
            ((formData as any).ai_sample_low_confidence_threshold
              ?? (currentForm as any)?.ai_sample_low_confidence_threshold
              ?? null) as any,
          ai_calibration_auto_absorb_days:
            ((formData as any).ai_calibration_auto_absorb_days
              ?? (currentForm as any)?.ai_calibration_auto_absorb_days
              ?? 180),
          ai_monthly_cost_budget_usd:
            ((formData as any).ai_monthly_cost_budget_usd
              ?? (currentForm as any)?.ai_monthly_cost_budget_usd
              ?? null) as any,
          ai_disagreement_route_threshold:
            ((formData as any).ai_disagreement_route_threshold
              ?? (currentForm as any)?.ai_disagreement_route_threshold
              ?? null) as any,
          ai_max_attached_sources:
            ((formData as any).ai_max_attached_sources
              ?? (currentForm as any)?.ai_max_attached_sources
              ?? 3),
          ai_base_prompt_id:
            ((formData as any).ai_base_prompt_id
              ?? (currentForm as any)?.ai_base_prompt_id
              ?? null),
          ai_model_provider:
            ((formData as any).ai_model_provider
              ?? (currentForm as any)?.ai_model_provider
              ?? 'anthropic'),
        },
      });

      const questionIdMap = new Map<string, number>();
      // oldQid -> newQid for cloning per-question artifacts (rubrics)
      // below. Populated as new questions are created using the
      // (category_name, sort_order) pre-built lookup.
      const oldToNewQid = new Map<number, number>();

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

        const oldQidsForCat = oldQidByCatSort.get(category.category_name);

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
              role: (question.role ?? 'DETAIL') as any,
              rollup_rule: (question.rollup_rule ?? null) as any,
              // rollup_member_question_ids is set in a second pass below
              // because members may reference questions whose new IDs do
              // not exist yet at this point in the transaction.
            },
          });

          questionIdMap.set(`${ci}-${qi}`, q.id);
          const oldQid = oldQidsForCat?.get(qi);
          if (oldQid !== undefined) oldToNewQid.set(oldQid, q.id);

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

      // Second pass: resolve rollup member IDs now that every question
      // in this new form version has been created. Same rationale as
      // createForm; see resolveRollupMemberIds().
      for (let ci = 0; ci < formData.categories.length; ci++) {
        const category = formData.categories[ci];
        for (let qi = 0; qi < category.questions.length; qi++) {
          const question = category.questions[qi];
          if (question.role !== 'ROLLUP') continue;
          const newQid = questionIdMap.get(`${ci}-${qi}`);
          if (newQid === undefined) continue;
          const resolved = this.resolveRollupMemberIds(
            question.rollup_member_question_ids,
            formData,
            questionIdMap,
          );
          await tx.formQuestion.update({
            where: { id: newQid },
            data: { rollup_member_question_ids: resolved as any },
          });
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

      // Carry forward AI-overlay artifacts that were keyed against the
      // prior version's form_id (and per-question rubrics also keyed
      // against the prior question_ids). Without this block, every form
      // save silently wiped rubrics, rule-pack assignments, and
      // calibration history — which is exactly what happened between
      // form 99018 (v1) and 99019 (v2). Cloning here keeps "Save" a
      // safe, lossless operation; explicit edits via the dedicated
      // rubric / rule-pack / calibration endpoints continue to write
      // against the new form_id and naturally override the inherited
      // rows on next read.
      if (currentForm) {
        const prevRubrics = await tx.aiFormQuestionRubric.findMany({
          where: { form_id: form_id },
        });
        for (const r of prevRubrics) {
          const newQid = oldToNewQid.get(r.question_id);
          if (newQid === undefined) continue; // question removed in this version
          await tx.aiFormQuestionRubric.create({
            data: {
              form_id: form.id,
              question_id: newQid,
              rubric_md: r.rubric_md,
              updated_by: r.updated_by ?? null,
            },
          });
        }

        const prevRulePacks = await tx.aiFormRulePackAssignment.findMany({
          where: { form_id: form_id },
        });
        for (const rp of prevRulePacks) {
          await tx.aiFormRulePackAssignment.create({
            data: {
              form_id: form.id,
              rule_pack_id: rp.rule_pack_id,
              sort_order: rp.sort_order,
              updated_by: rp.updated_by ?? null,
            },
          });
        }

        const prevCalibMaps = await tx.aiCalibrationMap.findMany({
          where: { form_id: form_id },
        });
        for (const cm of prevCalibMaps) {
          await tx.aiCalibrationMap.create({
            data: {
              form_id: form.id,
              version: cm.version,
              sample_count: cm.sample_count,
              bins_json: cm.bins_json as any,
              is_active: cm.is_active,
              notes: cm.notes ?? null,
            },
          });
        }

        const prevCalibData = await tx.aiCalibrationData.findMany({
          where: { form_id: form_id },
        });
        for (const cd of prevCalibData) {
          await tx.aiCalibrationData.create({
            data: {
              form_id: form.id,
              ticket_id: cd.ticket_id,
              source: cd.source,
              source_kind: cd.source_kind,
              ai_submission_id: cd.ai_submission_id ?? null,
              human_submission_id: cd.human_submission_id ?? null,
              ai_answers: cd.ai_answers as any,
              human_answers: cd.human_answers as any,
              graded_by: cd.graded_by ?? null,
              in_rolling_set: cd.in_rolling_set,
              notes: cd.notes ?? null,
              absorbed_at: cd.absorbed_at ?? null,
              absorbed_by: cd.absorbed_by ?? null,
              absorbed_reason: cd.absorbed_reason ?? null,
            },
          });
        }
      }

      // Legacy fallback: the prior row had no group id (pre-backfill), so this
      // new version becomes the anchor of its own family.
      if (groupId == null) {
        await tx.form.update({ where: { id: form.id }, data: { form_group_id: form.id } });
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
