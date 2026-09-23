/**
 * Settings validation tests. These exist for one reason: a malformed or
 * hand-edited `ie_config` row must never widen a guardrail. A garbage cost cap
 * has to fall back to the default, not to "unlimited spend".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../../../../config/prisma', () => ({
  default: { ieConfig: { findUnique, upsert } },
}));

import {
  DEFAULT_DAILY_USD_CAP,
  DEFAULT_EXCLUDED_AGENTS,
  DEFAULT_KB_ANCHOR_URLS,
  DEFAULT_MAX_CALLS_PER_RUN,
  DEFAULT_SCHEDULE_ENABLED,
  DEFAULT_SCHEDULE_HOUR,
  DEFAULT_MIN_TALK_SECS,
  DEFAULT_SYSTEM_PERSONA,
  getMissedOpportunitySettings,
  saveMissedOpportunitySettings,
} from '../settings';

/** Stub the KV store from a plain key→value map; unlisted keys read as unset. */
function stubConfig(values: Record<string, string | null>) {
  findUnique.mockImplementation(async ({ where }: { where: { config_key: string } }) => {
    const v = values[where.config_key];
    return v === undefined ? null : { config_key: where.config_key, config_value: v };
  });
}

const savedValue = (key: string): string | undefined =>
  upsert.mock.calls.find(([a]) => a.where.config_key === key)?.[0].update.config_value;

beforeEach(() => {
  vi.clearAllMocks();
  stubConfig({});
});

describe('getMissedOpportunitySettings', () => {
  it('returns the documented defaults when nothing is stored', async () => {
    const s = await getMissedOpportunitySettings();
    expect(s).toEqual({
      minTalkSecs: DEFAULT_MIN_TALK_SECS,
      excludedAgents: [...DEFAULT_EXCLUDED_AGENTS],
      dailyUsdCap: DEFAULT_DAILY_USD_CAP,
      modelTier: 'reasoning',
      maxCallsPerRun: DEFAULT_MAX_CALLS_PER_RUN,
      systemPersona: DEFAULT_SYSTEM_PERSONA,
      kbAnchorUrls: [...DEFAULT_KB_ANCHOR_URLS],
      scheduleEnabled: DEFAULT_SCHEDULE_ENABLED,
      scheduleHour: DEFAULT_SCHEDULE_HOUR,
    });
  });

  it('reads stored values', async () => {
    stubConfig({
      missed_opps_min_talk_secs: '240',
      missed_opps_excluded_agents: 'Drew Feely, Joshua Barber',
      missed_opps_daily_usd_cap: '12.50',
      missed_opps_model_tier: 'reasoning',
      missed_opps_max_calls_per_run: '150',
      missed_opps_schedule_enabled: '0',
      missed_opps_schedule_hour: '7',
    });
    expect(await getMissedOpportunitySettings()).toEqual({
      minTalkSecs: 240,
      excludedAgents: ['Drew Feely', 'Joshua Barber'],
      dailyUsdCap: 12.5,
      modelTier: 'reasoning',
      maxCallsPerRun: 150,
      systemPersona: DEFAULT_SYSTEM_PERSONA,
      kbAnchorUrls: [...DEFAULT_KB_ANCHOR_URLS],
      scheduleEnabled: false,
      scheduleHour: 7,
    });
  });

  it('keeps the schedule on unless the row is explicitly "0"', async () => {
    // A malformed row must not be able to silently stop the daily review.
    stubConfig({ missed_opps_schedule_enabled: 'yes please' });
    expect((await getMissedOpportunitySettings()).scheduleEnabled).toBe(true);
  });

  it('defaults an unset or out-of-range hour rather than falling to midnight', async () => {
    expect((await getMissedOpportunitySettings()).scheduleHour).toBe(DEFAULT_SCHEDULE_HOUR);
    stubConfig({ missed_opps_schedule_hour: '' });
    expect((await getMissedOpportunitySettings()).scheduleHour).toBe(DEFAULT_SCHEDULE_HOUR);
    stubConfig({ missed_opps_schedule_hour: '24' });
    expect((await getMissedOpportunitySettings()).scheduleHour).toBe(DEFAULT_SCHEDULE_HOUR);
    // Midnight is a legitimate choice and must survive.
    stubConfig({ missed_opps_schedule_hour: '0' });
    expect((await getMissedOpportunitySettings()).scheduleHour).toBe(0);
  });

  it('reads stored anchor URLs, and an empty string means grounding is off', async () => {
    stubConfig({
      missed_opps_kb_anchor_urls:
        'http://know.crm.dm-us.com/books/job-account-executive/page/how-to-arp\nhttp://kb/books/x/page/y',
    });
    expect((await getMissedOpportunitySettings()).kbAnchorUrls).toEqual([
      'http://know.crm.dm-us.com/books/job-account-executive/page/how-to-arp',
      'http://kb/books/x/page/y',
    ]);
    stubConfig({ missed_opps_kb_anchor_urls: '' });
    expect((await getMissedOpportunitySettings()).kbAnchorUrls).toEqual([]);
  });

  it('reads a stored persona and falls back to the default when blank', async () => {
    stubConfig({ missed_opps_system_persona: 'Be a ruthless closer.' });
    expect((await getMissedOpportunitySettings()).systemPersona).toBe('Be a ruthless closer.');
    stubConfig({ missed_opps_system_persona: '   ' });
    expect((await getMissedOpportunitySettings()).systemPersona).toBe(DEFAULT_SYSTEM_PERSONA);
  });

  it('falls back to the default cap for a non-numeric value instead of spending freely', async () => {
    stubConfig({ missed_opps_daily_usd_cap: 'unlimited' });
    expect((await getMissedOpportunitySettings()).dailyUsdCap).toBe(DEFAULT_DAILY_USD_CAP);
  });

  it('falls back to the default cap for an out-of-range value', async () => {
    stubConfig({ missed_opps_daily_usd_cap: '99999' });
    expect((await getMissedOpportunitySettings()).dailyUsdCap).toBe(DEFAULT_DAILY_USD_CAP);
  });

  it('falls back on an out-of-range talk floor and call cap', async () => {
    stubConfig({ missed_opps_min_talk_secs: '0', missed_opps_max_calls_per_run: '999999' });
    const s = await getMissedOpportunitySettings();
    expect(s.minTalkSecs).toBe(DEFAULT_MIN_TALK_SECS);
    expect(s.maxCallsPerRun).toBe(DEFAULT_MAX_CALLS_PER_RUN);
  });

  it('falls back to the default tier for an unrecognised tier name', async () => {
    stubConfig({ missed_opps_model_tier: 'gpt-9' });
    expect((await getMissedOpportunitySettings()).modelTier).toBe('reasoning');
  });

  it('honours an explicitly stored cheap tier', async () => {
    stubConfig({ missed_opps_model_tier: 'cheap' });
    expect((await getMissedOpportunitySettings()).modelTier).toBe('cheap');
  });

  it('treats an explicitly empty exclusion list as "exclude nobody", not as unset', async () => {
    stubConfig({ missed_opps_excluded_agents: '' });
    expect((await getMissedOpportunitySettings()).excludedAgents).toEqual([]);
  });
});

describe('saveMissedOpportunitySettings', () => {
  it('rejects an out-of-range cost cap loudly rather than clamping silently', async () => {
    await expect(saveMissedOpportunitySettings({ dailyUsdCap: 5000 }))
      .rejects.toThrow(/Daily cost cap must be between/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range talk floor and call cap', async () => {
    await expect(saveMissedOpportunitySettings({ minTalkSecs: 5 }))
      .rejects.toThrow(/Minimum talk seconds/);
    await expect(saveMissedOpportunitySettings({ maxCallsPerRun: 0 }))
      .rejects.toThrow(/Max calls per run/);
  });

  it('rejects an unknown model tier', async () => {
    await expect(saveMissedOpportunitySettings({ modelTier: 'gpt-9' as never }))
      .rejects.toThrow(/Model tier/);
  });

  it('writes only the supplied keys', async () => {
    await saveMissedOpportunitySettings({ minTalkSecs: 240 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(savedValue('missed_opps_min_talk_secs')).toBe('240');
  });

  it('normalises the exclusion list to a trimmed comma-separated string', async () => {
    await saveMissedOpportunitySettings({ excludedAgents: ['  Drew Feely ', '', 'Joshua Barber'] });
    expect(savedValue('missed_opps_excluded_agents')).toBe('Drew Feely,Joshua Barber');
  });

  it('stores the cap at two decimals so the run comparison is exact', async () => {
    await saveMissedOpportunitySettings({ dailyUsdCap: 12.499 });
    expect(savedValue('missed_opps_daily_usd_cap')).toBe('12.50');
  });

  it('rejects an empty persona rather than storing a prompt with no judgment', async () => {
    await expect(saveMissedOpportunitySettings({ systemPersona: '   ' }))
      .rejects.toThrow(/persona cannot be empty/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('trims and stores a supplied persona', async () => {
    await saveMissedOpportunitySettings({ systemPersona: '  Be a ruthless closer.  ' });
    expect(savedValue('missed_opps_system_persona')).toBe('Be a ruthless closer.');
  });

  it('rejects an anchor URL that is not a BookStack page link', async () => {
    await expect(saveMissedOpportunitySettings({ kbAnchorUrls: ['not-a-url'] }))
      .rejects.toThrow(/not a valid BookStack page URL/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('stores valid anchor URLs newline-separated and drops blanks', async () => {
    await saveMissedOpportunitySettings({
      kbAnchorUrls: ['  http://kb/books/a/page/b ', '', 'http://kb/books/c/page/d'],
    });
    expect(savedValue('missed_opps_kb_anchor_urls')).toBe('http://kb/books/a/page/b\nhttp://kb/books/c/page/d');
  });

  it('stores an empty string when the anchor list is cleared (grounding off)', async () => {
    await saveMissedOpportunitySettings({ kbAnchorUrls: [] });
    expect(savedValue('missed_opps_kb_anchor_urls')).toBe('');
  });
});
