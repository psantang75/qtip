/**
 * Apply in-place updates to an already-seeded Contact Call Review Form
 * (v2 AI Pilot) using the current contents of `seedContactFormV3.data.ts`
 * as the source of truth.
 *
 * Use this when the data file has been edited (rubric wording tweaks,
 * `is_na_allowed` flips, `ai_review_guidance` rewrites, etc.) but you
 * want to preserve the existing form id instead of re-seeding a fresh
 * form. Safe to re-run — every operation is idempotent.
 *
 * What it patches:
 *   - `forms.ai_review_guidance` for the target form
 *   - `form_questions.question_text` (in case auditor-facing wording was
 *     reworded in the spec)
 *   - `form_questions.is_na_allowed` to match the spec's `is_na_allowed`
 *     flag (both directions: turns N/A on AND off)
 *   - `form_questions.is_critical` to match the spec's `is_critical`
 *     flag (both directions: promotes AND demotes critical gates)
 *   - re-upserts every per-question `rubric_md` from the spec
 *
 * Questions are resolved by (category_name, sort_order) rather than by
 * question_text, so wording changes don't break the lookup.
 *
 * What it does NOT patch (run the seed script instead if any of these
 * need to change):
 *   - category structure / weights / sort order
 *   - question type / yes_value / no_value
 *   - conditional gates
 *
 * Usage:
 *   cd backend
 *   npx tsx src/scripts/applyContactFormV3Updates.ts <form_id>
 *
 * Example:
 *   npx tsx src/scripts/applyContactFormV3Updates.ts 99018
 */

import 'dotenv/config';

import prisma from '../config/prisma';
import { upsertQuestionRubric } from '../services/aiReviewerPrompt';
import logger from '../config/logger';
import { CATEGORIES, FORM_META } from './seedContactFormV3.data';

const DEFAULT_FORM_ID = 99018;
const TRANSACTION_TIMEOUT_MS = 30_000;

function parseFormId(argv: string[]): number {
  const raw = argv[2];
  if (!raw) {
    console.warn(`[patch] No form id passed — defaulting to ${DEFAULT_FORM_ID}`);
    return DEFAULT_FORM_ID;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid form id: ${raw}`);
  }
  return n;
}

async function main(): Promise<void> {
  const formId = parseFormId(process.argv);
  console.log(`[patch] Target form id=${formId}`);

  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { id: true, form_name: true },
  });
  if (!form) {
    throw new Error(`Form id ${formId} not found.`);
  }
  console.log(`[patch] Found form: "${form.form_name}"`);

  // Build the spec table flattened in (category, sort_order) order so we
  // can resolve to DB ids without relying on question_text staying stable.
  interface SpecRow {
    slug: string;
    category_name: string;
    sort_order: number;
    text: string;
    is_na_allowed: boolean;
    is_critical: boolean;
    rubric_md: string | null;
  }
  const specRows: SpecRow[] = [];
  for (const cat of CATEGORIES) {
    let sortOrder = 0;
    for (const q of cat.questions) {
      specRows.push({
        slug: q.slug,
        category_name: cat.name,
        sort_order: sortOrder++,
        text: q.text,
        is_na_allowed: q.is_na_allowed ?? false,
        is_critical: q.is_critical ?? false,
        rubric_md: q.rubric_md ?? null,
      });
    }
  }
  const rubricCountSpec = specRows.filter((r) => r.rubric_md !== null).length;
  console.log(
    `[patch] Loaded spec: ${CATEGORIES.length} categories, ${specRows.length} questions, ${rubricCountSpec} rubrics`,
  );

  const dbQuestions = await prisma.formQuestion.findMany({
    where: { category: { form_id: formId } },
    select: {
      id: true,
      question_text: true,
      sort_order: true,
      is_na_allowed: true,
      is_critical: true,
      category: { select: { category_name: true } },
    },
  });

  const lookup = new Map<string, {
    id: number;
    question_text: string;
    is_na_allowed: boolean;
    is_critical: boolean;
  }>();
  for (const q of dbQuestions) {
    const key = `${q.category.category_name}::${q.sort_order}`;
    lookup.set(key, {
      id: q.id,
      question_text: q.question_text,
      is_na_allowed: q.is_na_allowed,
      is_critical: q.is_critical,
    });
  }

  const missing = specRows.filter((r) => !lookup.has(`${r.category_name}::${r.sort_order}`));
  if (missing.length > 0) {
    throw new Error(
      `[patch] Could not resolve ${missing.length} question(s) by (category_name, sort_order). ` +
        `Has the category structure changed? Missing: ` +
        missing.slice(0, 5).map((m) => `[${m.category_name}#${m.sort_order}] "${m.slug}: ${m.text}"`).join('; '),
    );
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const guidanceUpdate = await tx.form.update({
        where: { id: formId },
        data: { ai_review_guidance: FORM_META.ai_review_guidance },
        select: { id: true },
      });

      let textRenamed = 0;
      let naAllowedFlipped = 0;
      let criticalFlipped = 0;
      for (const spec of specRows) {
        const existing = lookup.get(`${spec.category_name}::${spec.sort_order}`)!;
        const data: { question_text?: string; is_na_allowed?: boolean; is_critical?: boolean } = {};
        if (existing.question_text !== spec.text) {
          data.question_text = spec.text;
          textRenamed += 1;
        }
        if (existing.is_na_allowed !== spec.is_na_allowed) {
          data.is_na_allowed = spec.is_na_allowed;
          naAllowedFlipped += 1;
        }
        if (existing.is_critical !== spec.is_critical) {
          data.is_critical = spec.is_critical;
          criticalFlipped += 1;
        }
        if (Object.keys(data).length > 0) {
          await tx.formQuestion.update({ where: { id: existing.id }, data });
        }
      }

      return { guidanceUpdated: !!guidanceUpdate, textRenamed, naAllowedFlipped, criticalFlipped };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_TIMEOUT_MS },
  );

  console.log(`[patch] Updated forms.ai_review_guidance (${result.guidanceUpdated ? 1 : 0} row)`);
  console.log(`[patch] Renamed question_text on ${result.textRenamed} question(s)`);
  console.log(`[patch] Flipped is_na_allowed on ${result.naAllowedFlipped} question(s)`);
  console.log(`[patch] Flipped is_critical on ${result.criticalFlipped} question(s)`);

  let rubricCount = 0;
  for (const spec of specRows) {
    if (!spec.rubric_md) continue;
    const existing = lookup.get(`${spec.category_name}::${spec.sort_order}`)!;
    await upsertQuestionRubric(formId, existing.id, spec.rubric_md, null);
    rubricCount += 1;
  }
  console.log(`[patch] Re-upserted ${rubricCount} rubrics`);

  console.log('');
  console.log(`[patch] DONE. Review at: /quality/ai-reviewer/forms/${formId}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('[patch] FAILED:', err);
    console.error('[patch] FAILED:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
