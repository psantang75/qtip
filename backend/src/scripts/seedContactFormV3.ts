/**
 * Seed the "Contact Call Review Form (v2 AI Pilot)" form into QTIP.
 *
 * One-shot script that creates a brand-new form (is_active=false) with the
 * v3 scoring redesign: 9 weighted category roll-ups carry all scoring,
 * detail questions are zero-valued for analytics + critical gating, and
 * per-question AI rubrics land in `ai_form_question_rubric` so the AI
 * Reviewer prompt can ground each verdict in specific evidence.
 *
 * Source data: `seedContactFormV3.data.ts` (FORM_META + CATEGORIES).
 *
 * Usage (from repo root):
 *   cd backend
 *   npx tsx src/scripts/seedContactFormV3.ts
 *
 * After the run, review the new form at:
 *   /quality/ai-reviewer/forms/<new_id>
 *
 * The form structure is editable in the Form Builder; per-question rubrics
 * are editable in the "Question Rubrics" card on the AI Reviewer detail
 * page. The form stays inactive until you flip it from the UI.
 */

import 'dotenv/config';

import prisma from '../config/prisma';
import { upsertQuestionRubric } from '../services/aiReviewerPrompt';
import logger from '../config/logger';
import { CATEGORIES, FORM_META } from './seedContactFormV3.data';

const CREATED_BY_USER_ID = 1;
const TRANSACTION_TIMEOUT_MS = 30_000;

function validateSpec(): void {
  const totalWeight = CATEGORIES.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.0001) {
    throw new Error(`Category weights must sum to 1.00; got ${totalWeight.toFixed(4)}`);
  }

  const allSlugs = new Set<string>();
  for (const cat of CATEGORIES) {
    for (const q of cat.questions) {
      if (allSlugs.has(q.slug)) {
        throw new Error(`Duplicate slug "${q.slug}" — slugs must be unique across the form.`);
      }
      allSlugs.add(q.slug);
      if (q.text.length > 255) {
        throw new Error(`Slug "${q.slug}" question_text is ${q.text.length} chars (max 255).`);
      }
    }
  }

  for (const cat of CATEGORIES) {
    for (const q of cat.questions) {
      for (const c of q.conditions ?? []) {
        if (!allSlugs.has(c.target_slug)) {
          throw new Error(
            `Slug "${q.slug}" has a condition targeting unknown slug "${c.target_slug}".`,
          );
        }
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('[seed] Validating spec invariants...');
  validateSpec();
  console.log('[seed] Spec valid.');

  console.log(`[seed] Creating form: "${FORM_META.form_name}"`);

  const result = await prisma.$transaction(
    async (tx) => {
      const form = await tx.form.create({
        data: {
          form_name: FORM_META.form_name,
          interaction_type: FORM_META.interaction_type,
          version: FORM_META.version,
          created_by: CREATED_BY_USER_ID,
          is_active: FORM_META.is_active,
          critical_cap_percent: FORM_META.critical_cap_percent,
          ai_enabled: FORM_META.ai_enabled,
          ai_review_guidance: FORM_META.ai_review_guidance,
          ai_submit_as_draft: FORM_META.ai_submit_as_draft,
          ai_sample_review_pct: FORM_META.ai_sample_review_pct,
          ai_sample_low_score_always: FORM_META.ai_sample_low_score_always,
        },
      });

      const slugToId: Record<string, number> = {};
      let questionCount = 0;

      for (const cat of CATEGORIES) {
        const dbCat = await tx.formCategory.create({
          data: {
            form_id: form.id,
            category_name: cat.name,
            weight: cat.weight,
            sort_order: cat.sort,
          },
        });

        let qSort = 0;
        for (const q of cat.questions) {
          const dbQ = await tx.formQuestion.create({
            data: {
              category_id: dbCat.id,
              question_text: q.text,
              question_type: q.type,
              weight: 1.0, // FormQuestion.weight is required but unused by the engine
              sort_order: qSort++,
              is_na_allowed: q.is_na_allowed ?? false,
              yes_value: q.yes_value ?? 0,
              no_value: q.no_value ?? 0,
              is_critical: q.is_critical ?? false,
            },
          });
          slugToId[q.slug] = dbQ.id;
          questionCount += 1;
        }
      }

      let conditionCount = 0;
      for (const cat of CATEGORIES) {
        for (const q of cat.questions) {
          for (const c of q.conditions ?? []) {
            await tx.formQuestionCondition.create({
              data: {
                question_id: slugToId[q.slug],
                target_question_id: slugToId[c.target_slug],
                condition_type: c.condition_type ?? 'EQUALS',
                target_value: c.target_value ?? 'YES',
                logical_operator: 'AND',
                group_id: 0,
                sort_order: 0,
              },
            });
            conditionCount += 1;
          }
        }
      }

      return { formId: form.id, slugToId, categoryCount: CATEGORIES.length, questionCount, conditionCount };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_TIMEOUT_MS },
  );

  console.log(`[seed] Inserted form id=${result.formId}`);
  console.log(`[seed] Inserted ${result.categoryCount} categories`);
  console.log(`[seed] Inserted ${result.questionCount} questions`);
  console.log(`[seed] Inserted ${result.conditionCount} conditions`);

  let rubricCount = 0;
  for (const cat of CATEGORIES) {
    for (const q of cat.questions) {
      if (!q.rubric_md) continue;
      const questionId = result.slugToId[q.slug];
      await upsertQuestionRubric(result.formId, questionId, q.rubric_md, null);
      rubricCount += 1;
    }
  }

  console.log(`[seed] Upserted ${rubricCount} rubrics`);
  console.log('');
  console.log(`[seed] DONE. Review at: /quality/ai-reviewer/forms/${result.formId}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('[seed] FAILED:', err);
    console.error('[seed] FAILED:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
