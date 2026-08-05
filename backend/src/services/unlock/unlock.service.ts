/**
 * Admin unlock / reopen for QA reviews and dispute determinations.
 *
 * QTIP has no lock column — status IS the lock. Unlocking therefore means
 * moving the record back to the status its existing edit guards already
 * accept, rather than adding a parallel permission system:
 *
 *   SUBMITTED / FINALIZED review  ->  DRAFT     (QA edits + re-submits)
 *   closed dispute determination  ->  OPEN      (agent re-edits, manager
 *                                                re-resolves; submission
 *                                                goes back to DISPUTED)
 *
 * Because that withdraws a score the agent has already seen, every unlock
 * writes an immutable `record_unlock` event carrying the reason, a snapshot
 * of what was withdrawn, and a deadline. It also writes an `audit_logs` row
 * in the same transaction, mirroring `adminUnlockShift` in
 * services/scheduling/schedule.shift.service.ts.
 *
 * Nothing here is destructive: answers are never deleted, and the only
 * fields cleared (the dispute resolution trio) are stashed in
 * `prior_snapshot` first so unlock.relock.service.ts can restore them.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { Prisma } from '../../generated/prisma/client';
import type { UnlockEntityType } from '../../generated/prisma/client';
import { getUnlockSettings } from './unlock.config';
import { assertKnownReasonCode } from './unlock.reasons';
import {
  UnlockServiceError,
  type UnlockRequest,
  type UnlockResult,
  type SubmissionPriorSnapshot,
  type DisputePriorSnapshot,
} from './unlock.types';

/** Dispute statuses that represent a closed determination. */
const CLOSED_DISPUTE_STATUSES = ['UPHELD', 'REJECTED', 'ADJUSTED'];

const MIN_REASON_NOTE = 20;

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

function daysSince(from: Date | null): number {
  if (!from) return 0;
  return Math.floor((Date.now() - from.getTime()) / 86_400_000);
}

function assertAdmin(isAdmin: boolean): void {
  if (!isAdmin) {
    throw new UnlockServiceError('Only an admin can reopen a locked record', 403, 'ADMIN_ONLY');
  }
}

function assertReason(req: UnlockRequest): void {
  if (!req.reason_code) {
    throw new UnlockServiceError('A reason code is required', 400, 'REASON_REQUIRED');
  }
  if (!req.reason_note || req.reason_note.trim().length < MIN_REASON_NOTE) {
    throw new UnlockServiceError(
      `A justification of at least ${MIN_REASON_NOTE} characters is required`,
      400,
      'REASON_REQUIRED',
    );
  }
}

/**
 * Shared cap + window checks. Throws 409 REOPEN_CAP_REACHED (hard stop) or
 * 409 BEYOND_WINDOW (soft — retry with confirmBeyondWindow). Returns whether
 * this unlock is a break-glass so the event can record it.
 */
async function assertReopenAllowed(
  reopenCount: number,
  anchorDate: Date | null,
  req: UnlockRequest,
): Promise<{ beyondWindow: boolean; relockDueAt: Date }> {
  const settings = await getUnlockSettings();

  if (reopenCount >= settings.max_per_record) {
    throw new UnlockServiceError(
      `This record has already been reopened ${reopenCount} time(s), which is the configured maximum. ` +
        'Raise the cap in Admin -> System Settings if this is genuinely necessary.',
      409,
      'REOPEN_CAP_REACHED',
    );
  }

  const age = daysSince(anchorDate);
  const beyondWindow = age > settings.window_days;
  if (beyondWindow && !req.confirmBeyondWindow) {
    throw new UnlockServiceError(
      `This record closed ${age} days ago, past the ${settings.window_days}-day reopen window. ` +
        'Reopening it will restate already-reported numbers.',
      409,
      'BEYOND_WINDOW',
    );
  }

  return { beyondWindow, relockDueAt: addDays(new Date(), settings.relock_days) };
}

async function auditRow(
  tx: Prisma.TransactionClient,
  actorId: number,
  action: string,
  targetId: number,
  targetType: string,
  details: object,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      user_id: actorId,
      action,
      target_id: targetId,
      target_type: targetType,
      details: JSON.stringify(details),
    },
  });
}

/**
 * Reopen a SUBMITTED or FINALIZED review so its author can correct it.
 *
 * Lands the submission in DRAFT, which is the only status `saveDraft` /
 * `promoteDraftToSubmitted` will touch. Answers, metadata, calls and ticket
 * links all stay exactly where they are — only `status` moves.
 */
export async function unlockSubmission(
  submissionId: number,
  actorId: number,
  isAdmin: boolean,
  req: UnlockRequest,
): Promise<UnlockResult> {
  assertAdmin(isAdmin);
  assertReason(req);
  await assertKnownReasonCode(req.reason_code);

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      total_score: true,
      submitted_at: true,
      submitted_by: true,
      reopen_count: true,
    },
  });
  if (!submission) {
    throw new UnlockServiceError('Submission not found', 404, 'NOT_FOUND');
  }
  if (submission.status === 'DRAFT') {
    throw new UnlockServiceError('This review is already a draft and can be edited as-is', 409, 'ALREADY_DRAFT');
  }
  if (submission.status === 'DISPUTED') {
    throw new UnlockServiceError(
      'This review has an open dispute. Resolve or reopen the dispute instead.',
      409,
      'USE_DISPUTE_UNLOCK',
    );
  }

  const { beyondWindow, relockDueAt } = await assertReopenAllowed(
    submission.reopen_count,
    submission.submitted_at,
    req,
  );

  const priorSnapshot: SubmissionPriorSnapshot = {
    submitted_at: submission.submitted_at.toISOString(),
  };

  const unlock = await prisma.$transaction(async (tx) => {
    const created = await tx.recordUnlock.create({
      data: {
        entity_type: 'SUBMISSION',
        entity_id: submissionId,
        submission_id: submissionId,
        unlocked_by: actorId,
        reason_code: req.reason_code,
        reason_note: req.reason_note.trim(),
        prior_status: submission.status,
        prior_score: submission.total_score,
        prior_snapshot: priorSnapshot as unknown as Prisma.InputJsonValue,
        assigned_to: submission.submitted_by,
        self_service: submission.submitted_by === actorId,
        relock_due_at: relockDueAt,
        beyond_window: beyondWindow,
      },
    });

    await tx.submission.update({
      where: { id: submissionId },
      data: { status: 'DRAFT', reopen_count: { increment: 1 } },
    });

    await auditRow(tx, actorId, 'submission.admin_unlock', submissionId, 'SUBMISSION', {
      unlock_id: created.id,
      previous_status: submission.status,
      new_status: 'DRAFT',
      prior_score: submission.total_score?.toString() ?? null,
      reason_code: req.reason_code,
      reason_note: req.reason_note.trim(),
      beyond_window: beyondWindow,
      relock_due_at: relockDueAt.toISOString(),
    });

    return created;
  });

  logger.info(
    `[UNLOCK] submission_id=${submissionId} reopened by user ${actorId} ` +
      `(${submission.status} -> DRAFT, reason=${req.reason_code}, beyond_window=${beyondWindow})`,
  );

  return {
    unlock_id: unlock.id,
    entity_type: 'SUBMISSION',
    entity_id: submissionId,
    submission_id: submissionId,
    prior_status: submission.status,
    prior_score: submission.total_score === null ? null : Number(submission.total_score),
    new_status: 'DRAFT',
    relock_due_at: relockDueAt,
    beyond_window: beyondWindow,
  };
}

/**
 * Reopen a closed dispute determination.
 *
 * Setting the dispute back to OPEN with `resolved_by` nulled satisfies both
 * existing guards at once: the agent regains edit rights on their reason
 * (controllers/dispute.controller.ts requires `status OPEN` + `resolved_by
 * NULL`) and the manager regains resolve rights
 * (manager.disputes.resolve.service.ts requires `status = 'OPEN'`).
 *
 * The score is deliberately NOT reverted. `dispute_score_history` already
 * holds PREVIOUS/ADJUSTED, and a re-resolve with ADJUST appends another row,
 * so the full trail survives either way.
 */
export async function unlockDispute(
  disputeId: number,
  actorId: number,
  isAdmin: boolean,
  req: UnlockRequest,
): Promise<UnlockResult> {
  assertAdmin(isAdmin);
  assertReason(req);
  await assertKnownReasonCode(req.reason_code);

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      submission_id: true,
      status: true,
      resolved_by: true,
      resolved_at: true,
      resolution_notes: true,
      reopen_count: true,
      submission: { select: { total_score: true, status: true } },
    },
  });
  if (!dispute) {
    throw new UnlockServiceError('Dispute not found', 404, 'NOT_FOUND');
  }
  if (!CLOSED_DISPUTE_STATUSES.includes(dispute.status)) {
    throw new UnlockServiceError(
      `This dispute is ${dispute.status}, not a closed determination — it can already be edited.`,
      409,
      'NOT_CLOSED',
    );
  }

  const { beyondWindow, relockDueAt } = await assertReopenAllowed(
    dispute.reopen_count,
    dispute.resolved_at,
    req,
  );

  const priorSnapshot: DisputePriorSnapshot = {
    dispute_status: dispute.status,
    resolved_by: dispute.resolved_by,
    resolved_at: dispute.resolved_at ? dispute.resolved_at.toISOString() : null,
    resolution_notes: dispute.resolution_notes,
  };

  const unlock = await prisma.$transaction(async (tx) => {
    const created = await tx.recordUnlock.create({
      data: {
        entity_type: 'DISPUTE',
        entity_id: disputeId,
        submission_id: dispute.submission_id,
        unlocked_by: actorId,
        reason_code: req.reason_code,
        reason_note: req.reason_note.trim(),
        prior_status: dispute.status,
        prior_score: dispute.submission.total_score,
        prior_snapshot: priorSnapshot as unknown as Prisma.InputJsonValue,
        assigned_to: dispute.resolved_by,
        self_service: dispute.resolved_by === actorId,
        relock_due_at: relockDueAt,
        beyond_window: beyondWindow,
      },
    });

    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'OPEN',
        resolved_by: null,
        resolved_at: null,
        resolution_notes: null,
        reopen_count: { increment: 1 },
      },
    });

    // The parent review is no longer complete while the dispute is open.
    await tx.submission.update({
      where: { id: dispute.submission_id },
      data: { status: 'DISPUTED' },
    });

    await auditRow(tx, actorId, 'dispute.admin_unlock', disputeId, 'DISPUTE', {
      unlock_id: created.id,
      submission_id: dispute.submission_id,
      previous_status: dispute.status,
      new_status: 'OPEN',
      prior_score: dispute.submission.total_score?.toString() ?? null,
      reason_code: req.reason_code,
      reason_note: req.reason_note.trim(),
      beyond_window: beyondWindow,
      relock_due_at: relockDueAt.toISOString(),
    });

    return created;
  });

  logger.info(
    `[UNLOCK] dispute_id=${disputeId} reopened by user ${actorId} ` +
      `(${dispute.status} -> OPEN, reason=${req.reason_code}, beyond_window=${beyondWindow})`,
  );

  return {
    unlock_id: unlock.id,
    entity_type: 'DISPUTE',
    entity_id: disputeId,
    submission_id: dispute.submission_id,
    prior_status: dispute.status,
    prior_score:
      dispute.submission.total_score === null ? null : Number(dispute.submission.total_score),
    new_status: 'OPEN',
    relock_due_at: relockDueAt,
    beyond_window: beyondWindow,
  };
}

/** The newest still-open unlock for a record, or null. */
export async function findOpenUnlock(entityType: UnlockEntityType, entityId: number) {
  return prisma.recordUnlock.findFirst({
    where: { entity_type: entityType, entity_id: entityId, state: 'OPEN' },
    orderBy: { unlocked_at: 'desc' },
  });
}

/**
 * Mark the newest open unlock closed because the record was legitimately
 * re-submitted / re-resolved. A no-op when nothing is open, so the normal
 * submit and dispute-resolve paths can call it unconditionally.
 */
export async function closeUnlock(
  entityType: UnlockEntityType,
  entityId: number,
  closedBy: number,
  outcome: { new_status?: string | null; new_score?: number | null } = {},
): Promise<void> {
  const open = await findOpenUnlock(entityType, entityId);
  if (!open) return;

  await prisma.recordUnlock.update({
    where: { id: open.id },
    data: {
      state: 'CLOSED',
      closed_at: new Date(),
      closed_by: closedBy,
      new_status: outcome.new_status ?? null,
      new_score:
        outcome.new_score === undefined || outcome.new_score === null
          ? null
          : new Prisma.Decimal(outcome.new_score),
    },
  });

  logger.info(
    `[UNLOCK] closed unlock_id=${open.id} (${entityType} ${entityId}) by user ${closedBy}` +
      `${outcome.new_score != null ? `, new score ${outcome.new_score}` : ''}`,
  );
}
