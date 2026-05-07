import { aiReviewerConfig } from '../../config/environment';

/**
 * The AI / QA actor disambiguation layer.
 *
 * Every submission has a `submitted_by` user id. When that id matches
 * the configured AI Reviewer system user, the submission was generated
 * by the AI; otherwise a human QA filed it.
 *
 * Email call sites compose the event key with `classify(submission)`:
 *
 *   `submission.audit_finalized_by_${classify(s)}`
 *   `submission.critical_fail_by_${classify(s)}`
 *
 * This means flipping a form's `ai_enabled` flag ON or OFF needs zero
 * email-system changes — the recipients, copy, and cadence all follow
 * whoever actually submitted, not the form's intent.
 */

export type ReviewerKind = 'ai' | 'qa';

export interface ClassifiableSubmission {
  submitted_by: number | null | undefined;
}

export function classifyReviewer(submission: ClassifiableSubmission): ReviewerKind {
  const aiUserId = aiReviewerConfig?.userId;
  if (aiUserId && submission.submitted_by === aiUserId) return 'ai';
  return 'qa';
}

export function isAiReviewer(userId: number | null | undefined): boolean {
  return !!aiReviewerConfig && userId === aiReviewerConfig.userId;
}
