/**
 * punchProvider.getPunchDays — the ACTUALS side that now also totals the on-clock
 * minutes the adherence numerator needs. These pin the two numbers that are new:
 * workMinutes (productive on-clock time) and breakMinutes (paid rest, measured so
 * the engine can drop anything over the allowance), plus the missing-clock-out
 * fallback that keeps a data problem from reading as time not worked.
 *
 * prisma is mocked so the block-summing logic is exercised without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock('../../../config/prisma', () => ({
  default: { punchRaw: { findMany: findManyMock } },
}));

import { getPunchDays } from '../punchProvider';
import type { PunchWindow } from '../punchProvider';

const D = '2026-07-15';
const at = (hhmm: string, dateStr = D): Date => new Date(`${dateStr}T${hhmm}:00`);

const USER = 1;
const KEY = `${USER}:${D}`;

/** A 09:00-17:00 shift window for the one test user. */
const window: PunchWindow = { userId: USER, dateStr: D, start: at('09:00'), end: at('17:00') };

/** A punch_raw block row. */
const block = (
  payType: string,
  inHm: string | null,
  outHm: string | null,
  typeIn: string | null,
  typeOut: string | null,
) => ({
  user_id: USER,
  punch_in_at: inHm ? at(inHm) : null,
  punch_out_at: outHm ? at(outHm) : null,
  punch_type_in: typeIn,
  punch_type_out: typeOut,
  pay_type: payType,
});

describe('getPunchDays — on-clock minute totals', () => {
  beforeEach(() => findManyMock.mockReset());

  it('sums Work and Break blocks and picks arrival/departure', async () => {
    findManyMock.mockResolvedValue([
      block('Work', '09:00', '12:00', 'Clock In', 'Begin Break'),
      block('Break', '12:00', '12:30', 'Begin Break', 'End Break'),
      block('Work', '12:30', '17:00', 'End Break', 'Clock Out'),
    ]);

    const out = await getPunchDays([window]);
    const day = out.get(KEY)!;

    expect(day.workMinutes).toBe(450); // 180 + 270
    expect(day.breakMinutes).toBe(30);
    expect(day.firstPunchAt).toEqual(at('09:00'));
    expect(day.lastPunchAt).toEqual(at('17:00'));
  });

  it('runs an open Work block to shift end when the Clock Out is missing', async () => {
    findManyMock.mockResolvedValue([
      block('Work', '09:00', '12:00', 'Clock In', 'Begin Break'),
      block('Break', '12:00', '12:30', 'Begin Break', 'End Break'),
      block('Work', '12:30', null, 'End Break', null), // never clocked out
    ]);

    const out = await getPunchDays([window]);
    const day = out.get(KEY)!;

    // 180 worked before break + 270 from 12:30 to the 17:00 shift end.
    expect(day.workMinutes).toBe(450);
    expect(day.breakMinutes).toBe(30);
    expect(day.lastPunchAt).toBeNull();
  });

  it('measures the full break even when it runs over the allowance', async () => {
    // Two break blocks totalling 45 minutes. punchProvider only measures; the
    // engine is what caps the credit at the scheduled allowance.
    findManyMock.mockResolvedValue([
      block('Work', '09:00', '10:30', 'Clock In', 'Begin Break'),
      block('Break', '10:30', '11:00', 'Begin Break', 'End Break'),
      block('Break', '14:00', '14:15', 'Begin Break', 'End Break'),
      block('Work', '11:00', '17:00', 'End Break', 'Clock Out'),
    ]);

    const out = await getPunchDays([window]);
    const day = out.get(KEY)!;

    expect(day.breakMinutes).toBe(45);
  });

  it('reports zeros for a day with no punches', async () => {
    findManyMock.mockResolvedValue([]);

    const out = await getPunchDays([window]);
    const day = out.get(KEY)!;

    expect(day).toEqual({ firstPunchAt: null, lastPunchAt: null, workMinutes: 0, breakMinutes: 0 });
  });
});
