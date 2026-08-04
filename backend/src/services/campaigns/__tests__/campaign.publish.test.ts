/**
 * Publish gating for campaign calendars. The rule under test: an unpublished
 * month does not exist for an agent — not the schedule, not the month, and not
 * as a 403 that would leak that one is being drafted.
 *
 * Admin, Director and Manager all carry canViewAll, which is exactly the set
 * allowed to read drafts; agents do not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/prisma', () => {
  const db = {
    campaignScheduleMonth: { findUnique: vi.fn(), upsert: vi.fn() },
    campaignSchedule: { update: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { default: db };
});
vi.mock('../../scheduling/schedule.permissions', () => ({
  resolveScope: vi.fn(async () => ({ viewerId: 7, canViewAll: true, departmentIds: null, isAdmin: true })),
}));
vi.mock('../campaign.permissions', () => ({ assertCanWriteSchedule: vi.fn(async () => undefined) }));

import prisma from '../../../config/prisma';
import { assertMonthVisible, canSeeDrafts, monthKey, setMonthPublished } from '../campaign.publish.service';
import type { AuthReq, ScheduleScope } from '../../scheduling/schedule.types';

const db = prisma as unknown as {
  campaignScheduleMonth: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }
  campaignSchedule: { update: ReturnType<typeof vi.fn> }
};
const findUniqueMock = db.campaignScheduleMonth.findUnique;

const scope = (canViewAll: boolean): ScheduleScope => ({
  viewerId: 7, canViewAll, departmentIds: null, isAdmin: canViewAll,
});
const agent = scope(false);
const manager = scope(true);

const published = { id: 1, status: 'PUBLISHED' as const };
const draft = { id: 1, status: 'DRAFT' as const };

const monthRow = (status: 'DRAFT' | 'PUBLISHED' | null) =>
  findUniqueMock.mockResolvedValue(status === null ? null : { status });

describe('monthKey', () => {
  it('zero-pads the month so keys sort lexically', () => {
    expect(monthKey(2026, 8)).toBe('2026-08');
    expect([monthKey(2026, 10), monthKey(2026, 9)].sort()).toEqual(['2026-09', '2026-10']);
  });
});

describe('canSeeDrafts', () => {
  it('is true for the non-agent roles and false for agents', () => {
    expect(canSeeDrafts(manager)).toBe(true);
    expect(canSeeDrafts(agent)).toBe(false);
  });
});

describe('assertMonthVisible', () => {
  beforeEach(() => findUniqueMock.mockReset());

  it('lets a manager open a draft month without touching the month table', async () => {
    await expect(assertMonthVisible(manager, draft, 2026, 8)).resolves.toBeUndefined();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('lets an agent open a published month of a published schedule', async () => {
    monthRow('PUBLISHED');
    await expect(assertMonthVisible(agent, published, 2026, 8)).resolves.toBeUndefined();
  });

  it('hides a month with no row at all from an agent', async () => {
    monthRow(null);
    await expect(assertMonthVisible(agent, published, 2026, 8)).rejects.toMatchObject({
      statusCode: 404, code: 'NOT_PUBLISHED',
    });
  });

  it('hides an explicitly unpublished month from an agent', async () => {
    monthRow('DRAFT');
    await expect(assertMonthVisible(agent, published, 2026, 8)).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });

  it('hides every month of a draft schedule, however the month is flagged', async () => {
    monthRow('PUBLISHED');
    await expect(assertMonthVisible(agent, draft, 2026, 8)).rejects.toMatchObject({ code: 'NOT_PUBLISHED' });
  });
});

describe('setMonthPublished', () => {
  const req = {} as AuthReq;

  beforeEach(() => {
    db.campaignScheduleMonth.upsert.mockReset().mockResolvedValue({});
    db.campaignSchedule.update.mockReset().mockResolvedValue({});
  });

  it('releases the schedule alongside the month, so one button is enough', async () => {
    await expect(setMonthPublished(req, 1, 2026, 8, true)).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(db.campaignScheduleMonth.upsert).toHaveBeenCalledOnce();
    expect(db.campaignSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ status: 'PUBLISHED', published_by: 7 }) }),
    );
  });

  it('leaves the schedule and every other month alone when one month is pulled', async () => {
    await expect(setMonthPublished(req, 1, 2026, 8, false)).resolves.toMatchObject({ status: 'DRAFT' });
    expect(db.campaignScheduleMonth.upsert).toHaveBeenCalledOnce();
    expect(db.campaignSchedule.update).not.toHaveBeenCalled();
  });
});
