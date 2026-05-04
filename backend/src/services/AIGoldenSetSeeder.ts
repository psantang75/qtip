/**
 * AIGoldenSetSeeder
 *
 * Auto-promotes eligible AI submissions into ai_golden_set so the
 * golden eval runner has data to work with from Day 1 without a
 * manual curation step. Eligibility is intentionally strict — we want
 * a high-quality gold set, not a large one:
 *
 *   1. The submission has a calibration row (i.e. a human reviewed it)
 *   2. The AI's answers and the human's answers MATCH on every question
 *      (the strongest possible "the AI got this exactly right" signal)
 *   3. The submission's score is at or above the form's critical_cap
 *      (so we're not gold-setting borderline-failing tickets)
 *   4. The submission is in COMPLETED status
 *   5. The submission isn't already in the golden set (unique key
 *      enforces idempotency, but we filter beforehand to avoid noisy
 *      P2002 logs)
 *
 * Runs on every server boot so the boot log shows seeding activity.
 * Daily via setInterval afterwards.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';

const DAY_MS = 24 * 60 * 60 * 1000;
let dailyIntervalRegistered = false;

export interface SeedResult {
  /** Number of new rows inserted into ai_golden_set this pass. */
  inserted: number;
  /** Per-form breakdown for diagnostic logging. */
  perForm: Array<{ form_id: number; inserted: number }>;
  /** Number of candidates that were considered. */
  considered: number;
}

/**
 * Type of an answer map stored in JSON columns.
 */
type AnswerMap = Record<string, string>;

/**
 * Returns true if every question in `human` exists in `ai` AND has an
 * identical (case-insensitive, trimmed) value, AND vice-versa. We
 * require BOTH sides to have the same key set so a partial human
 * grade doesn't produce a false-positive "match".
 */
function answersMatchExactly(ai: AnswerMap | null, human: AnswerMap | null): boolean {
  if (!ai || !human) return false;
  const aiKeys = Object.keys(ai);
  const humanKeys = Object.keys(human);
  if (aiKeys.length === 0 || humanKeys.length === 0) return false;
  if (aiKeys.length !== humanKeys.length) return false;
  for (const k of aiKeys) {
    if (!(k in human)) return false;
    const a = String(ai[k] ?? '').trim().toLowerCase();
    const h = String(human[k] ?? '').trim().toLowerCase();
    if (a !== h) return false;
  }
  return true;
}

/**
 * Run the seeder once. Idempotent — already-seeded submissions are
 * filtered out before insert.
 */
export async function runGoldenSetSeeder(): Promise<SeedResult> {
  // Pull all calibration rows for AI-enabled forms with both AI and human
  // sides present. Lookback isn't strictly necessary here (we re-evaluate
  // historically eligible rows on every pass), but a 12-month window keeps
  // the join load bounded if calibration_data ever grows large.
  const lookback = new Date(Date.now() - 365 * DAY_MS);
  const candidates = await prisma.aiCalibrationData.findMany({
    where: {
      created_at: { gte: lookback },
      ai_submission_id: { not: null },
      ai_answers: { not: undefined as any },
    },
    select: {
      id: true,
      form_id: true,
      ai_submission_id: true,
      ai_answers: true,
      human_answers: true,
    },
  });

  const considered = candidates.length;
  if (considered === 0) {
    return { inserted: 0, perForm: [], considered: 0 };
  }

  // Filter to exact-match rows.
  const matches: { formId: number; submissionId: number }[] = [];
  for (const c of candidates) {
    if (!c.ai_submission_id) continue;
    const ai = (c.ai_answers ?? null) as AnswerMap | null;
    const human = (c.human_answers ?? null) as AnswerMap | null;
    if (!answersMatchExactly(ai, human)) continue;
    matches.push({ formId: c.form_id, submissionId: c.ai_submission_id });
  }
  if (matches.length === 0) {
    return { inserted: 0, perForm: [], considered };
  }

  // Validate the AI submission meets the score and status criteria.
  const submissionIds = Array.from(new Set(matches.map((m) => m.submissionId)));
  const submissions = await prisma.submission.findMany({
    where: { id: { in: submissionIds }, status: 'SUBMITTED' as any },
    include: { form: { select: { id: true, critical_cap_percent: true } } },
  });
  const eligibleSubmissionIds = new Set<number>();
  for (const s of submissions) {
    const cap = s.form?.critical_cap_percent != null ? Number(s.form.critical_cap_percent) : null;
    const score = s.total_score != null ? Number(s.total_score) : null;
    if (cap == null || score == null) continue;
    if (score < cap) continue;
    eligibleSubmissionIds.add(s.id);
  }

  if (eligibleSubmissionIds.size === 0) {
    return { inserted: 0, perForm: [], considered };
  }

  // De-dupe against existing golden set rows.
  const existing = await prisma.aiGoldenSet.findMany({
    where: { submission_id: { in: Array.from(eligibleSubmissionIds) } },
    select: { submission_id: true },
  });
  const alreadyGolden = new Set(existing.map((e) => e.submission_id));

  const perFormCounts = new Map<number, number>();
  let inserted = 0;
  for (const m of matches) {
    if (!eligibleSubmissionIds.has(m.submissionId)) continue;
    if (alreadyGolden.has(m.submissionId)) continue;
    try {
      await prisma.aiGoldenSet.create({
        data: {
          form_id: m.formId,
          submission_id: m.submissionId,
          source: 'auto_seed',
        },
      });
      alreadyGolden.add(m.submissionId);
      perFormCounts.set(m.formId, (perFormCounts.get(m.formId) ?? 0) + 1);
      inserted += 1;
    } catch (err) {
      // Unique-key collisions are expected if two callers seed at once.
      // Anything else is logged for visibility but doesn't abort the loop.
      const msg = (err as Error).message;
      if (!msg.includes('Unique constraint')) {
        logger.warn(`[AI GOLDEN] insert skipped submission_id=${m.submissionId}: ${msg}`);
      }
    }
  }
  return {
    inserted,
    considered,
    perForm: Array.from(perFormCounts.entries()).map(([form_id, count]) => ({
      form_id,
      inserted: count,
    })),
  };
}

/**
 * Smoke-signal #2: run on boot so the golden-set seeder is visible in
 * stdout. Failures are logged but never block boot.
 */
export async function runGoldenSetSeederOnBoot(): Promise<void> {
  try {
    const result = await runGoldenSetSeeder();
    logger.info(
      `[AI REVIEWER] golden set seeder: ${result.inserted} candidates promoted (considered=${result.considered})`
    );
    for (const p of result.perForm) {
      logger.info(`[AI REVIEWER] golden set seeder: form_id=${p.form_id} added=${p.inserted}`);
    }
  } catch (err) {
    logger.error('[AI REVIEWER] golden set seeder failed on boot', { error: (err as Error).message });
  }

  if (!dailyIntervalRegistered) {
    dailyIntervalRegistered = true;
    const interval = setInterval(async () => {
      try {
        const result = await runGoldenSetSeeder();
        logger.info(`[AI REVIEWER] daily golden set seeder: ${result.inserted} candidates promoted`);
      } catch (err) {
        logger.error('[AI REVIEWER] daily golden set seeder failed', { error: (err as Error).message });
      }
    }, DAY_MS);
    if (typeof interval.unref === 'function') interval.unref();
  }
}
