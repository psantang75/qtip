/**
 * The default of `getScheduledShifts` is load-bearing: attendance denominators
 * come from PUBLISHED shifts only, so a stack of draft weeks can never mark
 * anyone absent. Queue coverage planning opts into drafts to preview a week
 * still being built, and it scores nothing.
 *
 * This asserts the default did not drift when that option was added — the kind
 * of regression that would be invisible until a discipline report was wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../scheduling/schedule.shift.service', () => ({ fetchShiftsInRange: vi.fn(async () => []) }));
vi.mock('../../../config/prisma', () => ({
  default: { scheduleException: { findMany: vi.fn(async () => []) } },
}));
vi.mock('../../../utils/businessCalendar', () => ({ getCalendarDayTypes: vi.fn(async () => new Map()) }));

import { fetchShiftsInRange } from '../../scheduling/schedule.shift.service';
import { getScheduledShifts } from '../scheduleProvider';

const day = new Date(2026, 8, 1);
/** fetchShiftsInRange(userIds, from, to, publishedOnly) */
const publishedOnlyArg = () => vi.mocked(fetchShiftsInRange).mock.calls[0][3];

beforeEach(() => vi.clearAllMocks());

describe('getScheduledShifts publishedOnly', () => {
  it('asks for published shifts only when no option is passed', async () => {
    await getScheduledShifts([1], day, day);
    expect(publishedOnlyArg()).toBe(true);
  });

  it('still asks for published only when the option object is empty', async () => {
    await getScheduledShifts([1], day, day, {});
    expect(publishedOnlyArg()).toBe(true);
  });

  it('includes drafts only when a caller explicitly opts in', async () => {
    await getScheduledShifts([1], day, day, { publishedOnly: false });
    expect(publishedOnlyArg()).toBe(false);
  });

  it('does not query at all for an empty user list', async () => {
    const out = await getScheduledShifts([], day, day, { publishedOnly: false });
    expect(out.size).toBe(0);
    expect(fetchShiftsInRange).not.toHaveBeenCalled();
  });
});
