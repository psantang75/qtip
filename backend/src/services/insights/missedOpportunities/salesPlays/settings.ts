/**
 * salesPlays.settings — admin-tunable scalars for the Phase 2 sales-plays
 * learning loop, stored in the existing `ie_config` KV store (no new table for
 * settings; the plays themselves live in `ie_sales_play`).
 *
 * Keys owned by this module:
 *   missed_opps_plays_enabled        master on/off. When off the monthly miner
 *                                    never runs (zero spend) AND active plays are
 *                                    not injected into the recommendation prompt.
 *   missed_opps_plays_roster         newline/comma-separated agent names to mine
 *                                    (the current active sales team only).
 *   missed_opps_plays_last_mined     YYYY-MM-DD of the last mined day; the miner
 *                                    resumes from the day after this, so each
 *                                    monthly run only processes new calls.
 *   missed_opps_plays_seed_days      first-run lookback when last_mined is unset.
 *   missed_opps_plays_monthly_usd_cap hard spend ceiling for one monthly mine.
 *   missed_opps_plays_schedule_day   day of month (1-28) the mine may run.
 *   missed_opps_plays_schedule_hour  hour (0-23, business timezone) it may run.
 *                                    These replaced a PM2 cron that also fired
 *                                    on every container start, so each deploy
 *                                    triggered an unscheduled LLM spend.
 *
 * Every value is validated on read AND write so a hand-edited row can never feed
 * the miner garbage (a bad cap must not mean "unlimited spend").
 */
import prisma from '../../../../config/prisma';

const ENABLED_KEY = 'missed_opps_plays_enabled';
const ROSTER_KEY = 'missed_opps_plays_roster';
const LAST_MINED_KEY = 'missed_opps_plays_last_mined';
const SEED_DAYS_KEY = 'missed_opps_plays_seed_days';
const MONTHLY_USD_CAP_KEY = 'missed_opps_plays_monthly_usd_cap';
const SCHEDULE_DAY_KEY = 'missed_opps_plays_schedule_day';
const SCHEDULE_HOUR_KEY = 'missed_opps_plays_schedule_hour';

/**
 * The current active sales team — the only reps whose calls the miner learns
 * from. Canonical `tblPhoneUser.Name` spellings (confirmed against the phone
 * roster) so a name here always matches candidate selection.
 */
export const DEFAULT_PLAYS_ROSTER: readonly string[] = [
  'Jamie Waldie',
  'Jason Spangler',
  'Steven Selley',
  'Mitchell Stempowski',
  'Vince Deleon',
];

/** Phase 2 ships ON per product direction; the toggle can disable it any time. */
export const DEFAULT_PLAYS_ENABLED = true;
export const DEFAULT_PLAYS_SEED_DAYS = 90;
export const DEFAULT_PLAYS_MONTHLY_USD_CAP = 25;
/**
 * 1st of the month at 06:00, matching the retired `ie-sales-plays-miner` cron.
 * Capped at 28 so the schedule fires in February too.
 */
export const DEFAULT_PLAYS_SCHEDULE_DAY = 1;
export const DEFAULT_PLAYS_SCHEDULE_HOUR = 6;

const SEED_DAYS_RANGE = { min: 7, max: 365 } as const;
const MONTHLY_USD_CAP_RANGE = { min: 1, max: 500 } as const;
const SCHEDULE_DAY_RANGE = { min: 1, max: 28 } as const;
const SCHEDULE_HOUR_RANGE = { min: 0, max: 23 } as const;
const ROSTER_MAX_COUNT = 25;
const ROSTER_NAME_MAX = 160;

export interface SalesPlaysSettings {
  enabled: boolean;
  roster: string[];
  /** Last mined business day (YYYY-MM-DD), or null if never mined. */
  lastMined: string | null;
  seedDays: number;
  monthlyUsdCap: number;
  /** Day of month (1-28) the mine may run. */
  scheduleDay: number;
  /** Earliest hour (0-23, business timezone) on that day. */
  scheduleHour: number;
}

async function readConfig(key: string): Promise<string | null> {
  const row = await prisma.ieConfig.findUnique({ where: { config_key: key } });
  return row?.config_value ?? null;
}

async function writeConfig(key: string, value: string, description: string): Promise<void> {
  await prisma.ieConfig.upsert({
    where: { config_key: key },
    create: { config_key: key, config_value: value, description },
    update: { config_value: value },
  });
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return fallback;
}

function parseRoster(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_PLAYS_ROSTER];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampedInt(raw: string | null, fallback: number, range: { min: number; max: number }): number {
  // A missing or blank row means "use the default". Checked explicitly because
  // Number(null) and Number('') are both 0 — harmless for ranges that start
  // above zero, but it would silently turn an unset hour into midnight.
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i >= range.min && i <= range.max ? i : fallback;
}

export async function getSalesPlaysSettings(): Promise<SalesPlaysSettings> {
  const [enabled, roster, lastMined, seedDays, cap, schedDay, schedHour] = await Promise.all([
    readConfig(ENABLED_KEY),
    readConfig(ROSTER_KEY),
    readConfig(LAST_MINED_KEY),
    readConfig(SEED_DAYS_KEY),
    readConfig(MONTHLY_USD_CAP_KEY),
    readConfig(SCHEDULE_DAY_KEY),
    readConfig(SCHEDULE_HOUR_KEY),
  ]);

  const capNum = Number(cap);
  const capValid = Number.isFinite(capNum)
    && capNum >= MONTHLY_USD_CAP_RANGE.min
    && capNum <= MONTHLY_USD_CAP_RANGE.max;

  return {
    enabled: parseBool(enabled, DEFAULT_PLAYS_ENABLED),
    roster: parseRoster(roster),
    lastMined: lastMined && DATE_RE.test(lastMined.trim()) ? lastMined.trim() : null,
    seedDays: clampedInt(seedDays, DEFAULT_PLAYS_SEED_DAYS, SEED_DAYS_RANGE),
    monthlyUsdCap: capValid ? Math.round(capNum * 100) / 100 : DEFAULT_PLAYS_MONTHLY_USD_CAP,
    scheduleDay: clampedInt(schedDay, DEFAULT_PLAYS_SCHEDULE_DAY, SCHEDULE_DAY_RANGE),
    scheduleHour: clampedInt(schedHour, DEFAULT_PLAYS_SCHEDULE_HOUR, SCHEDULE_HOUR_RANGE),
  };
}

export interface SalesPlaysSettingsPatch {
  enabled?: boolean;
  roster?: string[];
  seedDays?: number;
  monthlyUsdCap?: number;
  scheduleDay?: number;
  scheduleHour?: number;
}

/** Persists only the supplied keys; rejects out-of-range values loudly. */
export async function saveSalesPlaysSettings(
  patch: SalesPlaysSettingsPatch,
): Promise<SalesPlaysSettings> {
  if (patch.enabled !== undefined) {
    await writeConfig(
      ENABLED_KEY, patch.enabled ? 'true' : 'false',
      'Missed Opportunities: sales-plays learning loop on/off (miner + prompt injection).',
    );
  }

  if (patch.roster !== undefined) {
    const cleaned = patch.roster.map((s) => s.trim()).filter((s) => s.length > 0);
    if (cleaned.length > ROSTER_MAX_COUNT) {
      throw new Error(`At most ${ROSTER_MAX_COUNT} reps may be mined`);
    }
    for (const name of cleaned) {
      if (name.length > ROSTER_NAME_MAX) {
        throw new Error(`"${name.slice(0, 40)}" is too long to be an agent name`);
      }
    }
    await writeConfig(
      ROSTER_KEY, cleaned.join('\n'),
      'Missed Opportunities: sales reps whose WON/LOST calls the plays miner learns from.',
    );
  }

  if (patch.seedDays !== undefined) {
    const v = Math.trunc(patch.seedDays);
    if (!Number.isFinite(v) || v < SEED_DAYS_RANGE.min || v > SEED_DAYS_RANGE.max) {
      throw new Error(`Seed lookback must be between ${SEED_DAYS_RANGE.min} and ${SEED_DAYS_RANGE.max} days`);
    }
    await writeConfig(
      SEED_DAYS_KEY, String(v),
      'Missed Opportunities: first-run lookback (days) for the plays miner when never mined.',
    );
  }

  if (patch.monthlyUsdCap !== undefined) {
    const v = Math.round(patch.monthlyUsdCap * 100) / 100;
    if (!Number.isFinite(v) || v < MONTHLY_USD_CAP_RANGE.min || v > MONTHLY_USD_CAP_RANGE.max) {
      throw new Error(
        `Monthly cost cap must be between $${MONTHLY_USD_CAP_RANGE.min} and $${MONTHLY_USD_CAP_RANGE.max}`,
      );
    }
    await writeConfig(
      MONTHLY_USD_CAP_KEY, v.toFixed(2),
      "Missed Opportunities: hard USD cap for a single month's plays-mining run.",
    );
  }

  if (patch.scheduleDay !== undefined) {
    const v = Math.trunc(patch.scheduleDay);
    if (!Number.isFinite(v) || v < SCHEDULE_DAY_RANGE.min || v > SCHEDULE_DAY_RANGE.max) {
      throw new Error(
        `Mine day must be between ${SCHEDULE_DAY_RANGE.min} and ${SCHEDULE_DAY_RANGE.max}`,
      );
    }
    await writeConfig(
      SCHEDULE_DAY_KEY, String(v),
      'Missed Opportunities: day of month the plays mine runs.',
    );
  }

  if (patch.scheduleHour !== undefined) {
    const v = Math.trunc(patch.scheduleHour);
    if (!Number.isFinite(v) || v < SCHEDULE_HOUR_RANGE.min || v > SCHEDULE_HOUR_RANGE.max) {
      throw new Error(
        `Mine hour must be between ${SCHEDULE_HOUR_RANGE.min} and ${SCHEDULE_HOUR_RANGE.max}`,
      );
    }
    await writeConfig(
      SCHEDULE_HOUR_KEY, String(v),
      'Missed Opportunities: earliest hour (business timezone) the plays mine runs.',
    );
  }

  return getSalesPlaysSettings();
}

/** Records the last mined business day so the next monthly run resumes after it. */
export async function setLastMined(dateYmd: string): Promise<void> {
  if (!DATE_RE.test(dateYmd)) throw new Error(`Invalid mined date: ${dateYmd}`);
  await writeConfig(
    LAST_MINED_KEY, dateYmd,
    'Missed Opportunities: last business day the plays miner processed (resume point).',
  );
}
