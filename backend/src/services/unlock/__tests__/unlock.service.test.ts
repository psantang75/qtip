/**
 * Guards on admin unlock. These are the controls that stand between "an admin
 * can fix a mis-scored review" and "an admin can quietly rewrite history", so
 * each one is pinned here rather than left to the UI to enforce.
 *
 * The invariants under test:
 *   - only an admin, and only with a real justification
 *   - the per-record cap is a hard stop; the age window is a soft one
 *   - a submission lands in DRAFT with its submitted_at snapshotted
 *   - a dispute lands OPEN with the resolution trio nulled but snapshotted,
 *     and the parent review returns to DISPUTED
 *   - closeUnlock is safe to call when nothing is open
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/prisma', () => {
  const db = {
    submission: { findUnique: vi.fn(), update: vi.fn() },
    dispute: { findUnique: vi.fn(), update: vi.fn() },
    recordUnlock: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { default: db };
});
vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../unlock.config', () => ({
  getUnlockSettings: vi.fn(async () => ({ window_days: 30, relock_days: 3, max_per_record: 2 })),
}));

import prisma from '../../../config/prisma';
import { getUnlockSettings } from '../unlock.config';
import { unlockSubmission, unlockDispute, closeUnlock } from '../unlock.service';
import type { UnlockRequest } from '../unlock.types';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  submission: { findUnique: Mock; update: Mock }
  dispute: { findUnique: Mock; update: Mock }
  recordUnlock: { create: Mock; findFirst: Mock; update: Mock }
  auditLog: { create: Mock }
};

const ADMIN = 9;
const QA = 4;
const MANAGER = 5;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const reason: UnlockRequest = {
  reason_code: 'SCORING_ERROR',
  reason_note: 'Question 4 was marked NO but the recording shows the disclosure was read.',
};

const submissionRow = (o: Record<string, unknown> = {}) => ({
  id: 100,
  status: 'FINALIZED',
  total_score: 88,
  submitted_at: daysAgo(2),
  submitted_by: QA,
  reopen_count: 0,
  ...o,
});

const disputeRow = (o: Record<string, unknown> = {}) => ({
  id: 200,
  submission_id: 100,
  status: 'REJECTED',
  resolved_by: MANAGER,
  resolved_at: daysAgo(2),
  resolution_notes: 'Original score stands.',
  reopen_count: 0,
  submission: { total_score: 88, status: 'FINALIZED' },
  ...o,
});

/** The `data` payload of the single recordUnlock.create call. */
const createdEvent = () => db.recordUnlock.create.mock.calls[0][0].data;
/** The `data` payload of the single auditLog.create call. */
const auditDetails = () => JSON.parse(db.auditLog.create.mock.calls[0][0].data.details);

beforeEach(() => {
  vi.mocked(getUnlockSettings).mockResolvedValue({ window_days: 30, relock_days: 3, max_per_record: 2 });
  db.submission.findUnique.mockReset().mockResolvedValue(submissionRow());
  db.submission.update.mockReset().mockResolvedValue({});
  db.dispute.findUnique.mockReset().mockResolvedValue(disputeRow());
  db.dispute.update.mockReset().mockResolvedValue({});
  db.recordUnlock.create.mockReset().mockResolvedValue({ id: 1 });
  db.recordUnlock.findFirst.mockReset().mockResolvedValue(null);
  db.recordUnlock.update.mockReset().mockResolvedValue({});
  db.auditLog.create.mockReset().mockResolvedValue({});
});

describe('unlockSubmission — guards', () => {
  it('refuses a non-admin before it reads anything', async () => {
    await expect(unlockSubmission(100, QA, false, reason)).rejects.toMatchObject({
      statusCode: 403, code: 'ADMIN_ONLY',
    });
    expect(db.submission.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a justification too short to explain anything', async () => {
    await expect(
      unlockSubmission(100, ADMIN, true, { ...reason, reason_note: 'oops' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'REASON_REQUIRED' });
  });

  it('sends a disputed review to the dispute path instead of reopening the review', async () => {
    db.submission.findUnique.mockResolvedValue(submissionRow({ status: 'DISPUTED' }));
    await expect(unlockSubmission(100, ADMIN, true, reason)).rejects.toMatchObject({
      code: 'USE_DISPUTE_UNLOCK',
    });
  });

  it('treats an already-DRAFT review as nothing to unlock', async () => {
    db.submission.findUnique.mockResolvedValue(submissionRow({ status: 'DRAFT' }));
    await expect(unlockSubmission(100, ADMIN, true, reason)).rejects.toMatchObject({
      code: 'ALREADY_DRAFT',
    });
  });

  it('hard-stops at the reopen cap — confirming does not get past it', async () => {
    db.submission.findUnique.mockResolvedValue(submissionRow({ reopen_count: 2 }));
    await expect(
      unlockSubmission(100, ADMIN, true, { ...reason, confirmBeyondWindow: true }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'REOPEN_CAP_REACHED' });
    expect(db.recordUnlock.create).not.toHaveBeenCalled();
  });

  it('asks for a second confirmation past the window, then proceeds and flags it', async () => {
    db.submission.findUnique.mockResolvedValue(submissionRow({ submitted_at: daysAgo(45) }));

    await expect(unlockSubmission(100, ADMIN, true, reason)).rejects.toMatchObject({
      statusCode: 409, code: 'BEYOND_WINDOW',
    });

    const result = await unlockSubmission(100, ADMIN, true, { ...reason, confirmBeyondWindow: true });
    expect(result.beyond_window).toBe(true);
    expect(createdEvent().beyond_window).toBe(true);
  });
});

describe('unlockSubmission — effect', () => {
  it('lands the review in DRAFT, counts the reopen, and snapshots what it withdrew', async () => {
    const submitted = daysAgo(2);
    db.submission.findUnique.mockResolvedValue(submissionRow({ submitted_at: submitted }));

    const result = await unlockSubmission(100, ADMIN, true, reason);

    expect(result).toMatchObject({
      entity_type: 'SUBMISSION', prior_status: 'FINALIZED', prior_score: 88, new_status: 'DRAFT',
    });
    expect(db.submission.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { status: 'DRAFT', reopen_count: { increment: 1 } },
    });

    const event = createdEvent();
    expect(event).toMatchObject({ prior_status: 'FINALIZED', assigned_to: QA, self_service: false });
    expect(event.prior_snapshot).toEqual({ submitted_at: submitted.toISOString() });
  });

  it('flags the unlock as self-service when the admin is also the reviewer', async () => {
    db.submission.findUnique.mockResolvedValue(submissionRow({ submitted_by: ADMIN }));
    await unlockSubmission(100, ADMIN, true, reason);
    expect(createdEvent().self_service).toBe(true);
  });

  it('writes the justification to the audit log in the same transaction', async () => {
    await unlockSubmission(100, ADMIN, true, reason);
    expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
      user_id: ADMIN, action: 'submission.admin_unlock', target_id: 100,
    });
    expect(auditDetails()).toMatchObject({
      previous_status: 'FINALIZED', new_status: 'DRAFT', reason_code: 'SCORING_ERROR',
    });
  });

  it('sets the re-lock deadline from the configured relock_days', async () => {
    vi.mocked(getUnlockSettings).mockResolvedValue({ window_days: 30, relock_days: 5, max_per_record: 2 });
    const result = await unlockSubmission(100, ADMIN, true, reason);
    const days = Math.round((result.relock_due_at.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(5);
  });
});

describe('unlockDispute', () => {
  it('refuses a dispute that is not a closed determination', async () => {
    db.dispute.findUnique.mockResolvedValue(disputeRow({ status: 'OPEN' }));
    await expect(unlockDispute(200, ADMIN, true, reason)).rejects.toMatchObject({ code: 'NOT_CLOSED' });
  });

  it('clears the resolution trio but snapshots it first', async () => {
    const resolved = daysAgo(2);
    db.dispute.findUnique.mockResolvedValue(disputeRow({ resolved_at: resolved }));

    await unlockDispute(200, ADMIN, true, reason);

    expect(db.dispute.update).toHaveBeenCalledWith({
      where: { id: 200 },
      data: {
        status: 'OPEN',
        resolved_by: null,
        resolved_at: null,
        resolution_notes: null,
        reopen_count: { increment: 1 },
      },
    });
    expect(createdEvent().prior_snapshot).toEqual({
      dispute_status: 'REJECTED',
      resolved_by: MANAGER,
      resolved_at: resolved.toISOString(),
      resolution_notes: 'Original score stands.',
    });
  });

  it('returns the parent review to DISPUTED so it stops counting as complete', async () => {
    await unlockDispute(200, ADMIN, true, reason);
    expect(db.submission.update).toHaveBeenCalledWith({
      where: { id: 100 }, data: { status: 'DISPUTED' },
    });
  });

  it('assigns the reopen to the manager who made the determination', async () => {
    await unlockDispute(200, ADMIN, true, reason);
    expect(createdEvent()).toMatchObject({ assigned_to: MANAGER, self_service: false, entity_type: 'DISPUTE' });
  });

  it('measures the window from the resolution date, not the submission date', async () => {
    db.dispute.findUnique.mockResolvedValue(disputeRow({ resolved_at: daysAgo(60) }));
    await expect(unlockDispute(200, ADMIN, true, reason)).rejects.toMatchObject({ code: 'BEYOND_WINDOW' });
  });
});

describe('closeUnlock', () => {
  it('does nothing when no event is open, so normal flows can call it blindly', async () => {
    await expect(closeUnlock('SUBMISSION', 100, QA)).resolves.toBeUndefined();
    expect(db.recordUnlock.update).not.toHaveBeenCalled();
  });

  it('records the outcome score against the open event', async () => {
    db.recordUnlock.findFirst.mockResolvedValue({ id: 7 });

    await closeUnlock('SUBMISSION', 100, QA, { new_status: 'SUBMITTED', new_score: 94.5 });

    const { where, data } = db.recordUnlock.update.mock.calls[0][0];
    expect(where).toEqual({ id: 7 });
    expect(data).toMatchObject({ state: 'CLOSED', closed_by: QA, new_status: 'SUBMITTED' });
    expect(Number(data.new_score)).toBe(94.5);
  });

  it('leaves new_score null when the caller has no score to report', async () => {
    db.recordUnlock.findFirst.mockResolvedValue({ id: 7 });
    await closeUnlock('DISPUTE', 200, MANAGER, { new_status: 'ADJUSTED' });
    expect(db.recordUnlock.update.mock.calls[0][0].data.new_score).toBeNull();
  });
});
