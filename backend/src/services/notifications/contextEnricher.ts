import prisma from '../../config/prisma';
import logger from '../../config/logger';

/**
 * Adds derived variables to a notification payload so individual
 * controllers don't have to remember to compute things like
 * "passLabel" or "criticalFailQuestions". Runs once per notify() call,
 * before render.
 *
 * Anything genuinely controller-scoped (request IP, request timestamp,
 * dispute originalScore captured pre-resolution) still has to come in
 * through the payload — that data is gone by the time we get here.
 */

const ROUTING_REASON_LABELS: Record<string, string> = {
  low_confidence: 'AI confidence was below the form threshold',
  score_below_threshold: 'the score was below the pass threshold',
  sampling: 'a random sample was pulled for human review',
  admin_override: 'an admin manually flagged it for review',
  critical_fail: 'a critical question failed',
};

function deriveRoutingReasonLabel(reason: unknown): string | undefined {
  if (typeof reason !== 'string') return undefined;
  return ROUTING_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

function derivePassLabel(score: unknown, threshold: unknown): string {
  const s = Number(score);
  const t = Number(threshold);
  if (!Number.isFinite(s)) return 'unknown';
  if (!Number.isFinite(t) || t <= 0) {
    return s >= 80 ? 'passed' : s >= 60 ? 'needs review' : 'failed';
  }
  if (s >= t) return 'passed';
  if (s >= t - 10) return 'needs review';
  return 'failed';
}

async function loadCriticalFailQuestions(submissionId: number): Promise<Array<{ text: string }>> {
  try {
    // Critical questions answered "no"/"false" on this submission. Mirrors
    // scoringUtil's NO_ANSWERS check used to compute critical_fail_count.
    const rows = await prisma.$queryRaw<Array<{ text: string }>>`
      SELECT fq.question_text AS text
        FROM submission_answers sa
        JOIN form_questions fq ON fq.id = sa.question_id
       WHERE sa.submission_id = ${submissionId}
         AND fq.is_critical = 1
         AND LOWER(COALESCE(sa.answer, '')) IN ('no', 'false')
       ORDER BY fq.id ASC
    `;
    return rows.map(r => ({ text: r.text }));
  } catch (err: any) {
    logger.debug('[contextEnricher] critical-fail Q lookup failed', {
      submissionId, error: err?.message,
    });
    return [];
  }
}

/**
 * Mutates `payload` in-place to add derived variables. Returns the
 * same reference for chaining.
 */
export async function enrichPayload(
  event: string,
  payload: Record<string, any>,
): Promise<Record<string, any>> {
  // Submission events: passLabel
  if (event.startsWith('submission.') && payload.submission && payload.form) {
    if (payload.passLabel === undefined) {
      payload.passLabel = derivePassLabel(
        payload.submission.total_score,
        payload.form.pass_threshold ?? payload.form.passing_score ?? null,
      );
    }
  }

  // Critical-fail events: load failed-critical questions
  if (event.startsWith('submission.critical_fail') && payload.submission?.id != null) {
    if (payload.criticalFailQuestions === undefined) {
      payload.criticalFailQuestions = await loadCriticalFailQuestions(Number(payload.submission.id));
    }
  }

  // AI routing: friendly reason label
  if (event === 'ai.review_routed_to_qa') {
    if (payload.routingReasonLabel === undefined) {
      payload.routingReasonLabel = deriveRoutingReasonLabel(payload.routingReason)
        ?? 'this AI review needs your sign-off';
    }
  }

  // Dispute resolution: derive disputeDenied flag from status
  if (event === 'dispute.resolved' && payload.dispute) {
    if (payload.disputeDenied === undefined) {
      const status = String(payload.dispute.status ?? '').toUpperCase();
      payload.disputeDenied = status === 'DENIED' || status === 'REJECTED';
    }
    if (payload.originalScore === undefined && payload.submission?.previous_total_score != null) {
      payload.originalScore = payload.submission.previous_total_score;
    }
  }

  return payload;
}
