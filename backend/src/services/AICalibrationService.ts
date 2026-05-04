/**
 * AICalibrationService
 *
 * Persists and reads `ai_calibration_data` rows so the form-builder
 * calibration tab and the AI Reviewer eval can answer one question:
 *
 *   "On this form, how often does the AI agree with the human?"
 *
 * A calibration data point is one (ticket × form) pair holding both the
 * AI's answers and the human's answers. The tag in `source` records
 * where the row came from:
 *
 *   - 'qa_promoted_draft'   : a Calibrating-mode AI DRAFT was promoted by
 *                              a human; AI's draft answers are the AI
 *                              side, human's edits are the human side
 *   - 'qa_sample_review'    : a Trusted-mode AI submission was sampled
 *                              and re-graded by a human; the AI's saved
 *                              submission is the AI side, the human's
 *                              new submission is the human side
 *
 * Phase A scope: write + minimal read. Rolling-metric aggregation lives
 * here so Phase C's UI can call it directly without re-implementing
 * agreement math in the controller layer.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';
import { computeCohensKappa, type RaterPair } from './agreementMath';

export type CalibrationSource =
  | 'qa_promoted_draft'
  | 'qa_sample_review';

export type AnswerMap = Record<number, string>;

export interface CalibrationDataPoint {
  id: number;
  created_at: Date;
  form_id: number;
  ticket_id: number;
  source: CalibrationSource;
  ai_submission_id: number | null;
  human_submission_id: number | null;
  ai_answers: AnswerMap | null;
  human_answers: AnswerMap;
  graded_by: number | null;
  in_rolling_set: boolean;
  notes: string | null;
}

export interface RollingMetrics {
  form_id: number;
  window_size: number;
  sample_count: number;
  oldest_in_window_at: Date | null;
  /**
   * Per-ticket overall agreement: 1.0 means every recorded question matched.
   * @deprecated as of Phase 5 (Industry Parity) — `overall_kappa` is the
   * primary metric. Kept for backward compatibility with existing UI cards.
   */
  overall_agreement: number | null;
  /**
   * Cohen's kappa across all (ai, human) answer pairs in the rolling
   * window. NULL when sample_count is too small (< 5 pairs) or only
   * one category was used by both raters. The readiness ladder uses
   * this rather than raw % agreement so chance-level agreement on
   * skewed-distribution questions doesn't look like real agreement.
   */
  overall_kappa: number | null;
  per_question_agreement: Array<{
    question_id: number;
    /** @deprecated Use `kappa` for the chance-corrected agreement. */
    agreement: number;
    /** Cohen's kappa for this question; NaN/null when insufficient data. */
    kappa: number | null;
    n: number;
  }>;
  last_30d_count: number;
}

export interface ShouldRouteInput {
  total_score: number | null;
  critical_cap_percent: number | null;
  ai_sample_review_pct: number;
  ai_sample_low_score_always: boolean;
  /** Optional deterministic seed used by tests; production uses Math.random(). */
  rng?: () => number;
}

/**
 * One per-question correction surfaced by `getRecentCorrections` and
 * injected into the AI prompt as a few-shot lesson. Only includes rows
 * where the human's grade differed from the AI's grade — agreements
 * teach nothing.
 */
export interface CalibrationCorrection {
  question_id: number;
  /** Question text resolved at fetch time so the prompt is self-explanatory. */
  question_text: string;
  /** What the AI originally answered (normalized). */
  ai_value: string;
  /** What the human corrected it to (normalized). */
  human_value: string;
  ticket_id: number;
  source: CalibrationSource;
  created_at: Date;
  /** Calibration row id, surfaced so the UI preview can deep-link. */
  data_point_id: number;
  /**
   * Free-text "Why are you correcting the AI?" the reviewer typed during
   * promote/overlay. Sourced from ai_calibration_data.notes. Surfaced
   * to the prompt as a "Reviewer's reason" bullet so the AI internalizes
   * the human's rationale, not just the corrected value.
   */
  correction_reason: string | null;
}

export interface RecentCorrectionsOpts {
  /**
   * Greedy character cap on the rendered correction block. Default ~6000
   * chars (~1500 tokens). Older corrections roll off naturally when the
   * budget fills, giving the "fluid, ongoing" learning behavior without
   * unbounded prompt growth.
   */
  tokenBudgetChars?: number;
  /** Drop corrections older than this. Defaults to 365 days. */
  maxAgeDays?: number;
}

export type ModeReadinessRecommendation =
  | 'PROMOTE_TO_TRUSTED'
  | 'STAY_CALIBRATING'
  | 'CONSIDER_DEMOTE'
  | 'INSUFFICIENT_DATA';

export interface ModeReadinessResult {
  recommendation: ModeReadinessRecommendation;
  /** @deprecated Use `rolling_kappa`. Kept for legacy UI cards. */
  rolling_agreement: number | null;
  /** Cohen's kappa over the rolling window — Phase 5 primary metric. */
  rolling_kappa: number | null;
  sample_count: number;
  last_30d_count: number;
  current_mode: 'CALIBRATING' | 'TRUSTED';
  thresholds: {
    /** Phase 5 primary thresholds. */
    promote_kappa: number;
    promote_min_samples: number;
    demote_kappa: number;
    demote_min_30d_samples: number;
    /** @deprecated kept for backward-compat with old UI cards. */
    promote_agreement: number;
    /** @deprecated kept for backward-compat with old UI cards. */
    demote_agreement: number;
  };
}

/**
 * Readiness thresholds switched from raw % agreement (`*_agreement`)
 * to Cohen's kappa (`*_kappa`) in Phase 5. Kappa is chance-corrected,
 * so a question with very skewed answer distributions ("90% of tickets
 * are non-critical") doesn't make the AI look great just by always
 * picking the majority class.
 *
 * Initial thresholds based on standard kappa interpretation guides:
 *   - 0.6 (substantial agreement) is the bar for promoting to TRUSTED
 *   - 0.4 (moderate agreement) is the floor before demoting
 * Tighten these once we have real-data baselines from Phase 8 docs.
 *
 * `*_agreement` thresholds are kept for backward compatibility but no
 * longer drive the decision.
 */
const READINESS_THRESHOLDS = {
  promote_kappa: 0.6,
  promote_min_samples: 20,
  demote_kappa: 0.4,
  demote_min_30d_samples: 10,
  // Deprecated — kept so existing UI tooltips don't NPE.
  promote_agreement: 0.9,
  demote_agreement: 0.8,
} as const;

/** Default char budget for the corrections block. ~1.5k tokens. */
const DEFAULT_CORRECTIONS_BUDGET_CHARS = 6000;
const DEFAULT_MAX_AGE_DAYS = 365;

/** Per-question rolling kappa cache (Phase 6 — disagreement-driven sampling). */
const PER_QUESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const perQuestionCache = new Map<
  string,
  { byQid: Map<number, { kappa: number | null; n: number }>; fetchedAt: number }
>();

class AICalibrationServiceError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 500) {
    super(message);
    this.name = 'AICalibrationServiceError';
  }
}

class AICalibrationService {
  /**
   * Captures the diff between an AI DRAFT and the human-edited version
   * that promoted it. Caller passes the AI's pre-promotion answers
   * (snapshot taken before SubmissionService.promoteDraftToSubmitted
   * overwrites them) and the human's final answers. Both submissions
   * point at the same row in `submissions` after promotion — that's the
   * id we store in both ai_submission_id and human_submission_id.
   */
  async recordPromotedDraft(args: {
    formId: number;
    ticketId: number;
    submissionId: number;
    aiAnswers: AnswerMap;
    humanAnswers: AnswerMap;
    gradedBy: number;
    /** Free-text "Why are you correcting the AI?" reason from the reviewer. */
    correctionReason?: string | null;
  }): Promise<number> {
    return this.insertRow({
      formId: args.formId,
      ticketId: args.ticketId,
      source: 'qa_promoted_draft',
      aiSubmissionId: args.submissionId,
      humanSubmissionId: args.submissionId,
      aiAnswers: args.aiAnswers,
      humanAnswers: args.humanAnswers,
      gradedBy: args.gradedBy,
      notes: normalizeReason(args.correctionReason),
    });
  }

  /**
   * Captures a Trusted-mode sample review: the AI submission stays as
   * the system of record, and the human's re-audit is recorded as a new
   * separate submission. We store both ids so the calibration tab can
   * link back to either.
   */
  async recordSampleReview(args: {
    formId: number;
    ticketId: number;
    aiSubmissionId: number;
    humanSubmissionId: number;
    aiAnswers: AnswerMap;
    humanAnswers: AnswerMap;
    gradedBy: number;
    /** Free-text "Why are you correcting the AI?" reason from the reviewer. */
    correctionReason?: string | null;
  }): Promise<number> {
    return this.insertRow({
      formId: args.formId,
      ticketId: args.ticketId,
      source: 'qa_sample_review',
      aiSubmissionId: args.aiSubmissionId,
      humanSubmissionId: args.humanSubmissionId,
      aiAnswers: args.aiAnswers,
      humanAnswers: args.humanAnswers,
      gradedBy: args.gradedBy,
      notes: normalizeReason(args.correctionReason),
    });
  }

  /**
   * Returns the rolling agreement window for one form. Default size is
   * 50 most recent in_rolling_set rows that have BOTH ai_answers and
   * human_answers (rows without an AI side are skipped because they
   * have nothing to compare against).
   */
  async getRollingMetrics(formId: number, windowSize: number = 50): Promise<RollingMetrics> {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    if (!Number.isInteger(windowSize) || windowSize <= 0 || windowSize > 1000) {
      throw new AICalibrationServiceError('windowSize must be 1..1000', 'INVALID_WINDOW', 400);
    }

    const rows = await prisma.aiCalibrationData.findMany({
      where: { form_id: formId, in_rolling_set: true },
      orderBy: { created_at: 'desc' },
      take: windowSize,
    });

    const compared = rows.filter((r) => r.ai_answers != null);

    let totalQuestions = 0;
    let matches = 0;
    const perQ = new Map<number, { n: number; matches: number; pairs: RaterPair[] }>();
    const allPairs: RaterPair[] = [];

    for (const row of compared) {
      const ai = (row.ai_answers ?? {}) as AnswerMap;
      const human = (row.human_answers ?? {}) as AnswerMap;
      // Compare only over questions the human graded — drives "did the
      // AI match what the human said" rather than "did the AI fill in
      // every question the form ever had".
      for (const qidStr of Object.keys(human)) {
        const qid = Number(qidStr);
        if (!Number.isInteger(qid)) continue;
        const humanVal = normalizeAnswer(human[qid]);
        const aiVal = normalizeAnswer(ai[qid]);
        const matched = humanVal === aiVal;
        totalQuestions++;
        if (matched) matches++;
        const bucket = perQ.get(qid) ?? { n: 0, matches: 0, pairs: [] };
        bucket.n++;
        if (matched) bucket.matches++;
        bucket.pairs.push([aiVal, humanVal]);
        perQ.set(qid, bucket);
        allPairs.push([aiVal, humanVal]);
      }
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const last30d = await prisma.aiCalibrationData.count({
      where: { form_id: formId, created_at: { gte: thirtyDaysAgo } },
    });

    // Kappa needs >= 5 pairs to be meaningful — single-pair / very-small
    // windows produce wildly unstable values that mislead readiness.
    const overallKappa = allPairs.length >= 5 ? safeKappa(allPairs) : null;

    return {
      form_id: formId,
      window_size: windowSize,
      sample_count: compared.length,
      oldest_in_window_at: rows.length > 0 ? rows[rows.length - 1].created_at : null,
      overall_agreement: totalQuestions > 0 ? matches / totalQuestions : null,
      overall_kappa: overallKappa,
      per_question_agreement: Array.from(perQ.entries()).map(([qid, b]) => ({
        question_id: qid,
        agreement: b.n > 0 ? b.matches / b.n : 0,
        kappa: b.n >= 5 ? safeKappa(b.pairs) : null,
        n: b.n,
      })),
      last_30d_count: last30d,
    };
  }

  /**
   * Returns the most-recent N rows for a form for the calibration tab's
   * "recent diffs" panel. Caller will render the per-row diff in the UI.
   */
  async listRecent(formId: number, limit: number = 20): Promise<CalibrationDataPoint[]> {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
      throw new AICalibrationServiceError('limit must be 1..200', 'INVALID_LIMIT', 400);
    }
    const rows = await prisma.aiCalibrationData.findMany({
      where: { form_id: formId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    return rows.map(rowToDataPoint);
  }

  /**
   * Returns the calibration data points stored for a single ticket on
   * a given form. Used by the eval CLI when running per-form
   * regressions from the DB.
   */
  async findByFormAndTicket(formId: number, ticketId: number): Promise<CalibrationDataPoint[]> {
    const rows = await prisma.aiCalibrationData.findMany({
      where: { form_id: formId, ticket_id: ticketId },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(rowToDataPoint);
  }

  /**
   * Recent human corrections this form has accumulated, formatted for
   * injection into the AI prompt as few-shot lessons. Only emits rows
   * where the AI's answer differed from the human's — agreements teach
   * nothing. Per-question dedup keeps only the *most recent* correction
   * for each question (so a question that flipped multiple times still
   * teaches one current rule).
   *
   * "Fluid, ongoing" capped by character budget rather than row count:
   * we greedy-fill until the budget is exhausted, newest first, so as
   * calibration data grows the model always sees the freshest lessons.
   */
  async getRecentCorrections(
    formId: number,
    opts: RecentCorrectionsOpts = {}
  ): Promise<CalibrationCorrection[]> {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    const tokenBudgetChars = opts.tokenBudgetChars ?? DEFAULT_CORRECTIONS_BUDGET_CHARS;
    const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    const sinceCutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

    // Absorbed corrections are excluded here so they stop costing few-shot
    // tokens once their lesson has been baked into a rule pack or per-form
    // guidance — but they REMAIN in the rolling set so they still count for
    // agreement / kappa stats. See the absorb lifecycle in
    // backend/src/services/AICalibrationAbsorbSweep.ts and the manual
    // POST /calibration/:id/absorb endpoint.
    const rows = await prisma.aiCalibrationData.findMany({
      where: {
        form_id: formId,
        in_rolling_set: true,
        absorbed_at: null,
        created_at: { gte: sinceCutoff },
      },
      orderBy: { created_at: 'desc' },
    });

    // Walk newest → oldest; skip questions we've already captured (we only
    // want the most recent correction per question_id).
    const seenQuestions = new Set<number>();
    const candidates: CalibrationCorrection[] = [];
    for (const row of rows) {
      const ai = (row.ai_answers ?? {}) as AnswerMap;
      const human = (row.human_answers ?? {}) as AnswerMap;
      // Without an AI side, there's no "correction" to learn from.
      if (!row.ai_answers) continue;

      for (const qidStr of Object.keys(human)) {
        const qid = Number(qidStr);
        if (!Number.isInteger(qid) || seenQuestions.has(qid)) continue;
        const aiVal = normalizeAnswer(ai[qid]);
        const humanVal = normalizeAnswer(human[qid]);
        if (!humanVal || aiVal === humanVal) continue; // no diff = no lesson
        seenQuestions.add(qid);
        candidates.push({
          question_id: qid,
          question_text: '', // filled in below from the form's questions
          ai_value: aiVal,
          human_value: humanVal,
          ticket_id: row.ticket_id,
          source: row.source as CalibrationSource,
          created_at: row.created_at,
          data_point_id: Number(row.id),
          correction_reason: row.notes && row.notes.trim().length > 0 ? row.notes.trim() : null,
        });
      }
    }

    if (candidates.length === 0) return [];

    // Resolve question_text in one batched query.
    const questionRows = await prisma.formQuestion.findMany({
      where: { id: { in: Array.from(seenQuestions) } },
      select: { id: true, question_text: true },
    });
    const textById = new Map(questionRows.map((q) => [q.id, q.question_text]));
    for (const c of candidates) {
      c.question_text = textById.get(c.question_id) ?? `(question #${c.question_id})`;
    }

    // Greedy-fill the char budget using the rendered length of each
    // correction block. We keep the rendering identical to what the
    // prompt builder will emit so the budget reflects real prompt cost.
    const out: CalibrationCorrection[] = [];
    let usedChars = 0;
    for (const c of candidates) {
      const block = renderCorrectionForBudget(c);
      if (usedChars + block.length > tokenBudgetChars && out.length > 0) break;
      out.push(c);
      usedChars += block.length;
    }
    return out;
  }

  /**
   * Lightweight "should we suggest a mode flip?" check for the AI
   * Reviewer detail page. Pure recommendation — flipping the mode itself
   * still requires the human to click the existing toggle.
   *
   * Thresholds are constants for v1 (no schema change).
   */
  async getModeReadiness(formId: number): Promise<ModeReadinessResult> {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    const form = await prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, ai_submit_as_draft: true },
    });
    if (!form) {
      throw new AICalibrationServiceError('Form not found', 'FORM_NOT_FOUND', 404);
    }
    const currentMode: 'CALIBRATING' | 'TRUSTED' = (form as any).ai_submit_as_draft
      ? 'CALIBRATING'
      : 'TRUSTED';

    const metrics = await this.getRollingMetrics(formId);
    const agreement = metrics.overall_agreement;
    const kappa = metrics.overall_kappa;
    const samples = metrics.sample_count;
    const last30d = metrics.last_30d_count;

    let recommendation: ModeReadinessRecommendation;
    if (samples < READINESS_THRESHOLDS.promote_min_samples) {
      recommendation = 'INSUFFICIENT_DATA';
    } else if (
      currentMode === 'CALIBRATING' &&
      kappa != null &&
      kappa >= READINESS_THRESHOLDS.promote_kappa
    ) {
      recommendation = 'PROMOTE_TO_TRUSTED';
    } else if (
      currentMode === 'TRUSTED' &&
      kappa != null &&
      kappa < READINESS_THRESHOLDS.demote_kappa &&
      last30d >= READINESS_THRESHOLDS.demote_min_30d_samples
    ) {
      recommendation = 'CONSIDER_DEMOTE';
    } else {
      recommendation = 'STAY_CALIBRATING';
    }

    return {
      recommendation,
      rolling_agreement: agreement,
      rolling_kappa: kappa,
      sample_count: samples,
      last_30d_count: last30d,
      current_mode: currentMode,
      thresholds: { ...READINESS_THRESHOLDS },
    };
  }

  /**
   * Sampling decision for a single Trusted-mode AI submission. Returns
   * true when the submission should be routed to the QA review inbox.
   *
   * Rules:
   *   1. If `ai_sample_low_score_always` is on AND the submission's
   *      score is below the form's critical cap, route it.
   *   2. Otherwise roll the dice with `ai_sample_review_pct`.
   *
   * Pure function — no DB access — so callers can use it during the
   * AI submission write path without paying a round-trip.
   *
   * NOTE on routing duplication: the AI inbox query in
   * backend/src/routes/ai-reviewer.routes.ts ALSO computes routing
   * decisions, and includes two additional reasons not modeled here
   * (low_confidence and low_question_agreement). That is intentional:
   * the inbox is the actual consumer of the routing decision, and it
   * has access to per-form thresholds and the rolling agreement cache
   * without needing to plumb them through the write path. This helper
   * exists for the score-based fast path that runs synchronously during
   * submission persistence. If you add a new routing reason, decide
   * deliberately whether it belongs here (cheap, write-path-eligible)
   * or only in the inbox materializer (needs DB lookups).
   */
  shouldRouteToReviewInbox(input: ShouldRouteInput): boolean {
    const score = input.total_score == null ? null : Number(input.total_score);
    const cap = input.critical_cap_percent == null ? null : Number(input.critical_cap_percent);
    if (input.ai_sample_low_score_always && score != null && cap != null && score < cap) {
      return true;
    }
    const pct = Math.max(0, Math.min(100, Number(input.ai_sample_review_pct) || 0));
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    const rng = input.rng ?? Math.random;
    return rng() * 100 < pct;
  }

  /**
   * Per-question rolling kappa over the most recent N calibration rows.
   * Cached in-memory for 5 minutes per form (keyed on formId + lookback)
   * because the inbox materializer hits this for every submission and the
   * answer changes slowly. The cache is purposely simple — no LRU, no
   * invalidation on writes — because the data only matters at the
   * minute/hour scale and the 5-min staleness floor is acceptable for
   * routing decisions.
   *
   * Used by the disagreement-driven sampling reason
   * (`routing_reason = 'low_question_agreement'`) in the AI inbox query.
   */
  async getRollingPerQuestionAgreement(
    formId: number,
    lookback: number = 50
  ): Promise<Map<number, { kappa: number | null; n: number }>> {
    if (!Number.isInteger(formId) || formId <= 0) return new Map();
    const cacheKey = `${formId}:${lookback}`;
    const cached = perQuestionCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < PER_QUESTION_CACHE_TTL_MS) {
      return cached.byQid;
    }
    const rows = await prisma.aiCalibrationData.findMany({
      where: { form_id: formId, in_rolling_set: true },
      orderBy: { created_at: 'desc' },
      take: lookback,
    });
    const byQid = new Map<number, RaterPair[]>();
    for (const row of rows) {
      if (!row.ai_answers) continue;
      const ai = row.ai_answers as AnswerMap;
      const human = (row.human_answers ?? {}) as AnswerMap;
      for (const qidStr of Object.keys(human)) {
        const qid = Number(qidStr);
        if (!Number.isInteger(qid)) continue;
        const a = normalizeAnswer(ai[qid]);
        const h = normalizeAnswer(human[qid]);
        if (!byQid.has(qid)) byQid.set(qid, []);
        byQid.get(qid)!.push([a, h]);
      }
    }
    const out = new Map<number, { kappa: number | null; n: number }>();
    for (const [qid, pairs] of byQid.entries()) {
      out.set(qid, { kappa: pairs.length >= 5 ? safeKappa(pairs) : null, n: pairs.length });
    }
    perQuestionCache.set(cacheKey, { byQid: out, fetchedAt: Date.now() });
    return out;
  }

  /**
   * Returns absorbed corrections for a form, formatted exactly like
   * `getRecentCorrections` so the LearnedCorrectionsPanel can render
   * them in a "Show absorbed" view alongside active corrections.
   * Newest-first; one row per (data_point, question_id) pair so a
   * single calibration row that touched 5 questions appears 5 times
   * (matching how active corrections are surfaced).
   */
  async getAbsorbedCorrections(formId: number, opts: { limit?: number } = {}): Promise<
    (CalibrationCorrection & { absorbed_at: Date; absorbed_reason: string | null })[]
  > {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const rows = await prisma.aiCalibrationData.findMany({
      where: { form_id: formId, absorbed_at: { not: null } },
      orderBy: { absorbed_at: 'desc' },
      take: limit,
    });
    if (rows.length === 0) return [];

    const allQids = new Set<number>();
    type Pending = {
      qid: number;
      ai: string;
      human: string;
      ticket_id: number;
      source: CalibrationSource;
      created_at: Date;
      data_point_id: number;
      correction_reason: string | null;
      absorbed_at: Date;
      absorbed_reason: string | null;
    };
    const pending: Pending[] = [];
    for (const row of rows) {
      const ai = (row.ai_answers ?? {}) as AnswerMap;
      const human = (row.human_answers ?? {}) as AnswerMap;
      if (!row.ai_answers) continue;
      for (const qidStr of Object.keys(human)) {
        const qid = Number(qidStr);
        if (!Number.isInteger(qid)) continue;
        const aiVal = normalizeAnswer(ai[qid]);
        const humanVal = normalizeAnswer(human[qid]);
        if (!humanVal || aiVal === humanVal) continue;
        allQids.add(qid);
        pending.push({
          qid,
          ai: aiVal,
          human: humanVal,
          ticket_id: row.ticket_id,
          source: row.source as CalibrationSource,
          created_at: row.created_at,
          data_point_id: Number(row.id),
          correction_reason: row.notes && row.notes.trim().length > 0 ? row.notes.trim() : null,
          absorbed_at: row.absorbed_at!,
          absorbed_reason: row.absorbed_reason,
        });
      }
    }

    const questionRows = await prisma.formQuestion.findMany({
      where: { id: { in: Array.from(allQids) } },
      select: { id: true, question_text: true },
    });
    const textById = new Map(questionRows.map((q) => [q.id, q.question_text]));

    return pending.map((p) => ({
      question_id: p.qid,
      question_text: textById.get(p.qid) ?? `(question #${p.qid})`,
      ai_value: p.ai,
      human_value: p.human,
      ticket_id: p.ticket_id,
      source: p.source,
      created_at: p.created_at,
      data_point_id: p.data_point_id,
      correction_reason: p.correction_reason,
      absorbed_at: p.absorbed_at,
      absorbed_reason: p.absorbed_reason,
    }));
  }

  /**
   * Mark a single calibration row as "absorbed": its lesson has been
   * baked into a rule pack or per-form guidance, so it should stop
   * being injected as a few-shot example. The row stays in the rolling
   * set for stats — this is a "stop teaching" knob, not a delete.
   *
   * Returns the updated row's basic info. Throws CALIB_NOT_FOUND if
   * the id doesn't exist, or CALIB_ALREADY_ABSORBED if it's already
   * absorbed (idempotent on the data, but the API surfaces the no-op
   * so the UI can render the right state).
   */
  async markAbsorbed(args: { dataPointId: number; userId: number; reason: string }): Promise<{
    id: number;
    form_id: number;
    absorbed_at: Date;
    absorbed_reason: string;
  }> {
    if (!Number.isInteger(args.dataPointId) || args.dataPointId <= 0) {
      throw new AICalibrationServiceError('Invalid data point id', 'INVALID_DATA_POINT_ID', 400);
    }
    if (!Number.isInteger(args.userId) || args.userId <= 0) {
      throw new AICalibrationServiceError('Invalid user id', 'INVALID_USER_ID', 400);
    }
    const reason = (args.reason ?? '').trim();
    if (!reason) {
      throw new AICalibrationServiceError(
        'absorbed_reason is required (where did you bake this lesson in?)',
        'EMPTY_ABSORBED_REASON',
        400
      );
    }
    if (reason.length > 255) {
      throw new AICalibrationServiceError(
        `absorbed_reason must be 255 chars or fewer (got ${reason.length})`,
        'ABSORBED_REASON_TOO_LONG',
        400
      );
    }

    const existing = await prisma.aiCalibrationData.findUnique({
      where: { id: BigInt(args.dataPointId) },
      select: { id: true, form_id: true, absorbed_at: true },
    });
    if (!existing) {
      throw new AICalibrationServiceError('Calibration row not found', 'CALIB_NOT_FOUND', 404);
    }
    if (existing.absorbed_at) {
      throw new AICalibrationServiceError('Already absorbed', 'CALIB_ALREADY_ABSORBED', 409);
    }

    const now = new Date();
    await prisma.aiCalibrationData.update({
      where: { id: BigInt(args.dataPointId) },
      data: {
        absorbed_at: now,
        absorbed_by: args.userId,
        absorbed_reason: reason,
      },
    });
    logger.info(
      `[AI CALIBRATION] absorbed data_point_id=${args.dataPointId} form_id=${existing.form_id} by user=${args.userId} reason="${reason}"`
    );
    return {
      id: args.dataPointId,
      form_id: existing.form_id,
      absorbed_at: now,
      absorbed_reason: reason,
    };
  }

  /**
   * Soft-archive ALL rolling-set calibration data for one form. Used
   * when the form's questions have changed materially and old
   * corrections now teach the AI about questions that no longer exist
   * in their original shape. Sets `in_rolling_set = false` on every
   * non-archived row and prefixes notes with [FORM_RESET ...] so the
   * historical audit trail is preserved. Does NOT touch other forms.
   */
  async resetCalibrationForForm(args: {
    formId: number;
    userId: number;
    reason: string;
  }): Promise<{ archived_count: number }> {
    if (!Number.isInteger(args.formId) || args.formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    const reason = (args.reason ?? '').trim();
    if (!reason) {
      throw new AICalibrationServiceError(
        'reason is required',
        'EMPTY_RESET_REASON',
        400
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = `[FORM_RESET ${stamp} user=${args.userId}] ${reason}`;
    // Two-step: read the active rows, then update them in bulk. We need
    // to preserve any existing notes by prefixing rather than overwriting.
    const active = await prisma.aiCalibrationData.findMany({
      where: { form_id: args.formId, in_rolling_set: true },
      select: { id: true, notes: true },
    });
    let archived = 0;
    for (const row of active) {
      const newNotes = row.notes && row.notes.trim().length > 0 ? `${prefix}\n---\n${row.notes}` : prefix;
      await prisma.aiCalibrationData.update({
        where: { id: row.id },
        data: { in_rolling_set: false, notes: newNotes.slice(0, 65535) },
      });
      archived += 1;
    }
    logger.warn(
      `[AI CALIBRATION] form-level reset form_id=${args.formId} archived=${archived} by user=${args.userId} reason="${reason}"`
    );
    return { archived_count: archived };
  }

  // ---- internals ---------------------------------------------------------

  private async insertRow(args: {
    formId: number;
    ticketId: number;
    source: CalibrationSource;
    aiSubmissionId: number | null;
    humanSubmissionId: number | null;
    aiAnswers: AnswerMap | null;
    humanAnswers: AnswerMap;
    gradedBy: number | null;
    notes?: string | null;
  }): Promise<number> {
    if (!Number.isInteger(args.formId) || args.formId <= 0) {
      throw new AICalibrationServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    if (!Number.isInteger(args.ticketId) || args.ticketId <= 0) {
      throw new AICalibrationServiceError('Invalid ticket id', 'INVALID_TICKET_ID', 400);
    }
    if (!args.humanAnswers || Object.keys(args.humanAnswers).length === 0) {
      throw new AICalibrationServiceError('humanAnswers cannot be empty', 'EMPTY_HUMAN_ANSWERS', 400);
    }

    try {
      const created = await prisma.aiCalibrationData.create({
        data: {
          form_id: args.formId,
          ticket_id: args.ticketId,
          source: args.source,
          ai_submission_id: args.aiSubmissionId ?? null,
          human_submission_id: args.humanSubmissionId ?? null,
          ai_answers: args.aiAnswers === null ? undefined : (args.aiAnswers as any),
          human_answers: args.humanAnswers as any,
          graded_by: args.gradedBy ?? null,
          notes: args.notes ?? null,
        },
        select: { id: true },
      });
      const id = Number(created.id);
      logger.info(
        `[AI CALIBRATION] recorded source=${args.source} form_id=${args.formId} ticket_id=${args.ticketId} id=${id}`
      );
      return id;
    } catch (err) {
      logger.error('[AI CALIBRATION] failed to insert calibration row', {
        error: (err as Error).message,
        source: args.source,
        formId: args.formId,
        ticketId: args.ticketId,
      });
      throw new AICalibrationServiceError(
        'Failed to record calibration data: ' + (err as Error).message,
        'CALIBRATION_INSERT_FAILED',
        500
      );
    }
  }
}

function normalizeAnswer(v: string | undefined | null): string {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

/**
 * Approximation of the per-correction prompt block used to budget the
 * corrections payload. Kept here (not in the prompt builder) so the
 * service can size the response without importing the prompt module
 * (avoids a circular dependency).
 *
 * The prompt builder produces the same shape; if you ever change one,
 * change both — the budget math will stay close enough either way
 * because we round generously.
 */
function renderCorrectionForBudget(c: CalibrationCorrection): string {
  const lines = [
    `- Question: "${c.question_text}"`,
    `  AI previously answered: ${c.ai_value || '(empty)'}`,
    `  Human corrected to: ${c.human_value || '(empty)'}`,
  ];
  if (c.correction_reason) {
    lines.push(`  Reviewer's reason: ${c.correction_reason}`);
  }
  lines.push(`  Source: ticket #${c.ticket_id}`);
  lines.push('');
  return lines.join('\n');
}

/** Trim, collapse to null when empty, soft-cap at 2000 chars (the column is TEXT). */
function normalizeReason(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return t.length > 2000 ? t.slice(0, 2000) : t;
}

/**
 * Wraps `computeCohensKappa` so a NaN result becomes `null` (instead
 * of leaking through to JSON.stringify and producing the literal
 * string "NaN", which breaks UI rendering). Returns the kappa value
 * rounded to 3 decimals, matching how it's stored in `ai_eval_runs`.
 */
function safeKappa(pairs: RaterPair[]): number | null {
  const k = computeCohensKappa(pairs);
  if (!Number.isFinite(k)) return null;
  return Math.round(k * 1000) / 1000;
}

function rowToDataPoint(row: {
  id: bigint | number;
  created_at: Date;
  form_id: number;
  ticket_id: number;
  source: string;
  ai_submission_id: number | null;
  human_submission_id: number | null;
  ai_answers: unknown;
  human_answers: unknown;
  graded_by: number | null;
  in_rolling_set: boolean;
  notes: string | null;
}): CalibrationDataPoint {
  return {
    id: Number(row.id),
    created_at: row.created_at,
    form_id: row.form_id,
    ticket_id: row.ticket_id,
    source: row.source as CalibrationSource,
    ai_submission_id: row.ai_submission_id,
    human_submission_id: row.human_submission_id,
    ai_answers: (row.ai_answers as AnswerMap | null) ?? null,
    human_answers: (row.human_answers as AnswerMap) ?? {},
    graded_by: row.graded_by,
    in_rolling_set: row.in_rolling_set === true,
    notes: row.notes ?? null,
  };
}

const aiCalibrationService = new AICalibrationService();
export default aiCalibrationService;
export { AICalibrationService, AICalibrationServiceError, READINESS_THRESHOLDS };
