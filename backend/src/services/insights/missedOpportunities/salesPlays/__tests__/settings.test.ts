/**
 * Sales-plays settings validation. Same contract as the Missed Opportunities
 * settings: a hand-edited `ie_config` row can never widen a guardrail (a garbage
 * monthly cap falls back to the default, not to "unlimited spend"), and the
 * on/off toggle is stored as an explicit boolean.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../../../../../config/prisma', () => ({
  default: { ieConfig: { findUnique, upsert } },
}));

import {
  DEFAULT_PLAYS_ENABLED,
  DEFAULT_PLAYS_MONTHLY_USD_CAP,
  DEFAULT_PLAYS_ROSTER,
  DEFAULT_PLAYS_SCHEDULE_DAY,
  DEFAULT_PLAYS_SCHEDULE_HOUR,
  DEFAULT_PLAYS_SEED_DAYS,
  getSalesPlaysSettings,
  saveSalesPlaysSettings,
  setLastMined,
} from '../settings';

function stubConfig(values: Record<string, string | null>) {
  findUnique.mockImplementation(async ({ where }: { where: { config_key: string } }) => {
    const v = values[where.config_key];
    return v === undefined ? null : { config_key: where.config_key, config_value: v };
  });
}

const savedValue = (key: string): string | undefined =>
  upsert.mock.calls.find(([a]) => a.where.config_key === key)?.[0].update.config_value;

/** Latest write for a key — needed when a test saves the same key twice. */
const lastSavedValue = (key: string): string | undefined =>
  [...upsert.mock.calls].reverse().find(([a]) => a.where.config_key === key)?.[0].update.config_value;

beforeEach(() => {
  vi.clearAllMocks();
  stubConfig({});
});

describe('getSalesPlaysSettings', () => {
  it('returns documented defaults when nothing is stored', async () => {
    expect(await getSalesPlaysSettings()).toEqual({
      enabled: DEFAULT_PLAYS_ENABLED,
      roster: [...DEFAULT_PLAYS_ROSTER],
      lastMined: null,
      seedDays: DEFAULT_PLAYS_SEED_DAYS,
      monthlyUsdCap: DEFAULT_PLAYS_MONTHLY_USD_CAP,
      scheduleDay: DEFAULT_PLAYS_SCHEDULE_DAY,
      scheduleHour: DEFAULT_PLAYS_SCHEDULE_HOUR,
    });
  });

  it('reads stored values, including an explicit off', async () => {
    stubConfig({
      missed_opps_plays_enabled: 'false',
      missed_opps_plays_roster: 'Steven Selley\nVince Deleon',
      missed_opps_plays_last_mined: '2026-08-31',
      missed_opps_plays_seed_days: '30',
      missed_opps_plays_monthly_usd_cap: '10.00',
      missed_opps_plays_schedule_day: '3',
      missed_opps_plays_schedule_hour: '7',
    });
    expect(await getSalesPlaysSettings()).toEqual({
      enabled: false,
      roster: ['Steven Selley', 'Vince Deleon'],
      lastMined: '2026-08-31',
      seedDays: 30,
      monthlyUsdCap: 10,
      scheduleDay: 3,
      scheduleHour: 7,
    });
  });

  it('falls back to the default cap for a non-numeric or out-of-range value', async () => {
    stubConfig({ missed_opps_plays_monthly_usd_cap: 'unlimited' });
    expect((await getSalesPlaysSettings()).monthlyUsdCap).toBe(DEFAULT_PLAYS_MONTHLY_USD_CAP);
    stubConfig({ missed_opps_plays_monthly_usd_cap: '99999' });
    expect((await getSalesPlaysSettings()).monthlyUsdCap).toBe(DEFAULT_PLAYS_MONTHLY_USD_CAP);
  });

  it('falls back to the default seed window when out of range', async () => {
    stubConfig({ missed_opps_plays_seed_days: '0' });
    expect((await getSalesPlaysSettings()).seedDays).toBe(DEFAULT_PLAYS_SEED_DAYS);
  });

  it('keeps an unset schedule hour on the default instead of midnight', async () => {
    // Number('') and Number(null) are both 0, and 0 is a legal hour — so a blank
    // row must be rejected before the range check, or the mine silently moves.
    stubConfig({ missed_opps_plays_schedule_hour: '   ' });
    expect((await getSalesPlaysSettings()).scheduleHour).toBe(DEFAULT_PLAYS_SCHEDULE_HOUR);
  });

  it('accepts an explicit midnight hour', async () => {
    stubConfig({ missed_opps_plays_schedule_hour: '0' });
    expect((await getSalesPlaysSettings()).scheduleHour).toBe(0);
  });

  it('falls back to the default day when out of range', async () => {
    // 29-31 are rejected so the schedule still fires in February.
    stubConfig({ missed_opps_plays_schedule_day: '31' });
    expect((await getSalesPlaysSettings()).scheduleDay).toBe(DEFAULT_PLAYS_SCHEDULE_DAY);
  });

  it('ignores a malformed last-mined date rather than resuming from garbage', async () => {
    stubConfig({ missed_opps_plays_last_mined: 'not-a-date' });
    expect((await getSalesPlaysSettings()).lastMined).toBeNull();
  });
});

describe('saveSalesPlaysSettings', () => {
  it('stores the toggle as an explicit boolean string', async () => {
    await saveSalesPlaysSettings({ enabled: false });
    expect(lastSavedValue('missed_opps_plays_enabled')).toBe('false');
    await saveSalesPlaysSettings({ enabled: true });
    expect(lastSavedValue('missed_opps_plays_enabled')).toBe('true');
  });

  it('normalises the roster to a trimmed newline-separated string', async () => {
    await saveSalesPlaysSettings({ roster: ['  Steven Selley ', '', 'Vince Deleon'] });
    expect(savedValue('missed_opps_plays_roster')).toBe('Steven Selley\nVince Deleon');
  });

  it('rejects an out-of-range monthly cap loudly rather than clamping', async () => {
    await expect(saveSalesPlaysSettings({ monthlyUsdCap: 5000 }))
      .rejects.toThrow(/Monthly cost cap must be between/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range seed window', async () => {
    await expect(saveSalesPlaysSettings({ seedDays: 5 }))
      .rejects.toThrow(/Seed lookback/);
  });

  it('rejects a schedule day that would skip February', async () => {
    await expect(saveSalesPlaysSettings({ scheduleDay: 30 })).rejects.toThrow(/day/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('stores a valid schedule day and hour', async () => {
    await saveSalesPlaysSettings({ scheduleDay: 2, scheduleHour: 0 });
    expect(savedValue('missed_opps_plays_schedule_day')).toBe('2');
    expect(savedValue('missed_opps_plays_schedule_hour')).toBe('0');
  });

  it('setLastMined rejects a malformed date', async () => {
    await expect(setLastMined('2026/09/09')).rejects.toThrow(/Invalid mined date/);
    await setLastMined('2026-09-09');
    expect(savedValue('missed_opps_plays_last_mined')).toBe('2026-09-09');
  });
});
