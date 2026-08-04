/**
 * The auto re-lock sweep. A reopened record nobody acted on has to go back
 * where it came from, because a score left withdrawn quietly disappears from
 * every report that filters on FINALIZED.
 *
 * The two things worth pinning: restore is exact (the dispute resolution trio
 * comes back byte-for-byte from the snapshot), and the sweep never stomps a
 * record somebody already moved on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/prisma', () => {
  const db = {
    submission: { findUnique: vi.fn(), update: vi.fn() },
    dispute: { findUnique: vi.fn(), update: vi.fn() },
    recordUnlock: { findMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { default: db };
});
vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import prisma from '../../../config/prisma';
import { runRelockSweep } from '../unlock.relock.service';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  submission: { findUnique: Mock; update: Mock }
  dispute: { findUnique: Mock; update: Mock }
  recordUnlock: { findMany: Mock; update: Mock }
  auditLog: { create: Mock }
};

const ADMIN = 9;
const MANAGER = 5;
const RESOLVED_AT = '2026-07-01T14:00:00.000Z';

const overdue = new Date(Date.now() - 3600_000);

const submissionUnlock = (o: Record<string, unknown> = {}) => ({
  id: 1,
  entity_type: 'SUBMISSION',
  entity_id: 100,
  submission_id: 100,
  unlocked_by: ADMIN,
  prior_status: 'FINALIZED',
  prior_snapshot: { submitted_at: '2026-07-01T10:00:00.000Z' },
  relock_due_at: overdue,
  ...o,
});

const disputeUnlock = (o: Record<string, unknown> = {}) => ({
  id: 2,
  entity_type: 'DISPUTE',
  entity_id: 200,
  submission_id: 100,
  unlocked_by: ADMIN,
  prior_status: 'REJECTED',
  prior_snapshot: {
    dispute_status: 'REJECTED',
    resolved_by: MANAGER,
    resolved_at: RESOLVED_AT,
    resolution_notes: 'Original score stands.',
  },
  relock_due_at: overdue,
  ...o,
});

beforeEach(() => {
  db.recordUnlock.findMany.mockReset().mockResolvedValue([]);
  db.recordUnlock.update.mockReset().mockResolvedValue({});
  db.submission.findUnique.mockReset().mockResolvedValue({ status: 'DRAFT' });
  db.submission.update.mockReset().mockResolvedValue({});
  db.dispute.findUnique.mockReset().mockResolvedValue({ status: 'OPEN' });
  db.dispute.update.mockReset().mockResolvedValue({});
  db.auditLog.create.mockReset().mockResolvedValue({});
});

describe('runRelockSweep', () => {
  it('does no work and touches nothing when nothing is overdue', async () => {
    await expect(runRelockSweep()).resolves.toEqual({ restored: 0, failed: 0 });
    expect(db.recordUnlock.update).not.toHaveBeenCalled();
  });

  it('only looks at open events past their deadline', async () => {
    await runRelockSweep();
    expect(db.recordUnlock.findMany.mock.calls[0][0].where).toMatchObject({ state: 'OPEN' });
  });

  it('puts an untouched review back to the status it was unlocked from', async () => {
    db.recordUnlock.findMany.mockResolvedValue([submissionUnlock()]);

    await expect(runRelockSweep()).resolves.toEqual({ restored: 1, failed: 0 });

    expect(db.submission.update).toHaveBeenCalledWith({
      where: { id: 100 }, data: { status: 'FINALIZED' },
    });
    expect(db.recordUnlock.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ state: 'AUTO_RELOCKED' }),
    });
  });

  it('leaves the reopen counter alone — the cap counts attempts, not successes', async () => {
    db.recordUnlock.findMany.mockResolvedValue([submissionUnlock()]);
    await runRelockSweep();
    expect(db.submission.update.mock.calls[0][0].data).not.toHaveProperty('reopen_count');
  });

  it('does not stomp a review the QA already re-submitted, but still closes the event', async () => {
    db.recordUnlock.findMany.mockResolvedValue([submissionUnlock()]);
    db.submission.findUnique.mockResolvedValue({ status: 'SUBMITTED' });

    await runRelockSweep();

    expect(db.submission.update).not.toHaveBeenCalled();
    expect(db.recordUnlock.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ state: 'AUTO_RELOCKED' }),
    });
  });

  it('restores a dispute determination exactly as it was snapshotted', async () => {
    db.recordUnlock.findMany.mockResolvedValue([disputeUnlock()]);

    await runRelockSweep();

    expect(db.dispute.update).toHaveBeenCalledWith({
      where: { id: 200 },
      data: {
        status: 'REJECTED',
        resolved_by: MANAGER,
        resolved_at: new Date(RESOLVED_AT),
        resolution_notes: 'Original score stands.',
      },
    });
    expect(db.submission.update).toHaveBeenCalledWith({
      where: { id: 100 }, data: { status: 'FINALIZED' },
    });
  });

  it('does not re-close a dispute a manager already re-resolved', async () => {
    db.recordUnlock.findMany.mockResolvedValue([disputeUnlock()]);
    db.dispute.findUnique.mockResolvedValue({ status: 'ADJUSTED' });

    await runRelockSweep();

    expect(db.dispute.update).not.toHaveBeenCalled();
    expect(db.submission.update).not.toHaveBeenCalled();
  });

  it('records the auto re-lock so the register can show nobody acted', async () => {
    db.recordUnlock.findMany.mockResolvedValue([submissionUnlock()]);

    await runRelockSweep();

    const row = db.auditLog.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ action: 'record.auto_relock', target_id: 100, target_type: 'SUBMISSION' });
    expect(JSON.parse(row.details)).toMatchObject({ unlock_id: 1, restored_status: 'FINALIZED' });
  });

  it('keeps going after one bad row so a single failure cannot stall the batch', async () => {
    db.recordUnlock.findMany.mockResolvedValue([submissionUnlock(), submissionUnlock({ id: 3, entity_id: 101 })]);
    db.submission.update.mockRejectedValueOnce(new Error('deadlock'));

    await expect(runRelockSweep()).resolves.toEqual({ restored: 1, failed: 1 });
  });
});
