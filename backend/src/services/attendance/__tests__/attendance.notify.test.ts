/**
 * Who gets told when somebody crosses a discipline rung, and how the system
 * avoids telling them twice.
 *
 * The delivery path mails whoever is named on a queue row, one row to one
 * mailbox, so the audience is expressed as several rows. The risk that matters is
 * re-notifying: points roll off and get re-crossed constantly in a 90-day window,
 * and an alert that fires again each time is an alert people learn to ignore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  queueFindUnique: vi.fn(),
  queueCreate: vi.fn(),
  userFindUnique: vi.fn(),
  loadWarningThresholds: vi.fn(),
  resolveRecipients: vi.fn(),
}));

vi.mock('../../../config/prisma', () => ({
  default: {
    attendanceOccurrence: { groupBy: mocks.groupBy },
    notificationQueueEntry: { findUnique: mocks.queueFindUnique, create: mocks.queueCreate },
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../attendance.config', () => ({
  loadWarningThresholds: mocks.loadWarningThresholds,
}));

vi.mock('../attendance.rollup.service', () => ({
  windowForFloored: vi.fn(async () => ({ asOf: '2026-08-03', from: '2026-05-05' })),
}));

vi.mock('../../notifications/RoleResolver', () => ({
  resolveRecipients: mocks.resolveRecipients,
}));

import { queueThresholdCrossings, ATTENDANCE_LEVEL_TEMPLATE } from '../attendance.notify';

const THRESHOLDS = [
  { levelKey: 'coaching', label: 'Coaching', pointsThreshold: 3, sortOrder: 10, effectiveFrom: '2020-01-01', effectiveTo: null, isActive: true },
  { levelKey: 'verbal', label: 'Verbal', pointsThreshold: 5, sortOrder: 20, effectiveFrom: '2020-01-01', effectiveTo: null, isActive: true },
];

const CSR = { id: 24, username: 'm.santangelo' };
const AGENT_RECIPIENT = { id: 24, username: 'm.santangelo', email: 'm@x.com', role_id: 6, matchedRole: 'agent' };
const ADMIN_RECIPIENT = { id: 1, username: 'pg.admin', email: 'a@x.com', role_id: 1, matchedRole: 'admins' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadWarningThresholds.mockResolvedValue(THRESHOLDS as any);
  mocks.groupBy.mockResolvedValue([{ user_id: 24, _sum: { points: 3.25 } }] as any);
  mocks.userFindUnique.mockResolvedValue(CSR as any);
  mocks.queueFindUnique.mockResolvedValue(null as any);
  mocks.queueCreate.mockResolvedValue({} as any);
  mocks.resolveRecipients.mockResolvedValue([AGENT_RECIPIENT, ADMIN_RECIPIENT] as any);
});

describe('queueThresholdCrossings', () => {
  it('queues one row per recipient, since one row reaches one mailbox', async () => {
    const queued = await queueThresholdCrossings('2026-08-03');

    expect(queued).toBe(2);
    expect(mocks.queueCreate).toHaveBeenCalledTimes(2);
    const userIds = mocks.queueCreate.mock.calls.map(c => (c[0] as any).data.user_id);
    expect(userIds.sort()).toEqual([1, 24]);
  });

  it('keeps the CSR on the historical dedupe key so existing suppressions still hold', async () => {
    // Changing this format would resurrect crossings that were deliberately
    // discarded, because the old key would no longer be found.
    await queueThresholdCrossings('2026-08-03');

    const keys = mocks.queueCreate.mock.calls.map(c => (c[0] as any).data.dedupe_key);
    expect(keys).toContain('attendance_level:24:coaching');
    expect(keys).toContain('attendance_level:24:coaching:u1');
  });

  it('skips the whole crossing when the rung was already claimed', async () => {
    // The CSR key is the claim. Somebody added to the audience later must not
    // receive a backlog of crossings announced months ago.
    mocks.queueFindUnique.mockImplementation(async (args: any) =>
      args.where.dedupe_key === 'attendance_level:24:coaching' ? { id: 5 } : null,
    );

    const queued = await queueThresholdCrossings('2026-08-03');

    expect(queued).toBe(0);
    expect(mocks.queueCreate).not.toHaveBeenCalled();
    expect(mocks.resolveRecipients).not.toHaveBeenCalled();
  });

  it('does not duplicate a recipient row that already exists', async () => {
    mocks.queueFindUnique.mockImplementation(async (args: any) =>
      args.where.dedupe_key === 'attendance_level:24:coaching:u1' ? { id: 9 } : null,
    );

    const queued = await queueThresholdCrossings('2026-08-03');

    expect(queued).toBe(1);
    expect((mocks.queueCreate.mock.calls[0][0] as any).data.user_id).toBe(24);
  });

  it('tells each row which audience it is for, so the copy can address them correctly', async () => {
    await queueThresholdCrossings('2026-08-03');

    const byUser = new Map(
      mocks.queueCreate.mock.calls.map(c => {
        const data = (c[0] as any).data;
        return [data.user_id, data.payload];
      }),
    );
    expect(byUser.get(24)).toMatchObject({ forRole: 'agent', csr: { id: 24, username: 'm.santangelo' } });
    expect(byUser.get(1)).toMatchObject({ forRole: 'admins', csr: { id: 24, username: 'm.santangelo' } });
  });

  it('records the level, points and threshold that triggered it', async () => {
    await queueThresholdCrossings('2026-08-03');

    expect((mocks.queueCreate.mock.calls[0][0] as any).data).toMatchObject({
      template_key: ATTENDANCE_LEVEL_TEMPLATE,
      payload: expect.objectContaining({ level: 'Coaching', points: 3.25, threshold: 3, asOf: '2026-08-03' }),
    });
  });

  it('reports only the highest rung reached, not every rung passed', async () => {
    mocks.groupBy.mockResolvedValue([{ user_id: 24, _sum: { points: 6 } }] as any);

    await queueThresholdCrossings('2026-08-03');

    const levels = mocks.queueCreate.mock.calls.map(c => (c[0] as any).data.payload.level);
    expect([...new Set(levels)]).toEqual(['Verbal']);
  });

  it('queues nothing for somebody below the lowest rung', async () => {
    mocks.groupBy.mockResolvedValue([{ user_id: 24, _sum: { points: 2.75 } }] as any);

    expect(await queueThresholdCrossings('2026-08-03')).toBe(0);
    expect(mocks.queueCreate).not.toHaveBeenCalled();
  });

  it('never throws into the caller, because a failed alert must not fail an import', async () => {
    mocks.groupBy.mockRejectedValue(new Error('db gone'));

    await expect(queueThresholdCrossings('2026-08-03')).resolves.toBe(0);
  });
});
