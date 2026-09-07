/**
 * adherence.settings — the admin-tunable values that are not effective-dated
 * bands, all stored in the existing `ie_config` KV store (like
 * attendance.settings.ts and unlock.config.ts). String-typed, validated on both
 * read and write so a hand-edited row can never feed the engine garbage.
 *
 * Keys owned by this module (seeded by 20260903150000_add_adherence):
 *   adherence_start_date            earliest date scored at all (a floor).
 *   adherence_points_active_from    date points begin counting toward the ladder.
 *                                   Before it, occurrences are recorded but score
 *                                   zero points — the report-only switch.
 *   adherence_phone_grace_before_sec  seconds the phone may go Break/Meal BEFORE
 *   adherence_phone_grace_after_sec   ...and stay AFTER the punched segment.
 *
 * Duration and start-time grace are NOT here: like attendance, that grace is the
 * gap below the lowest band, edited by editing the band.
 */
import prisma from '../../config/prisma';

const START_KEY = 'adherence_start_date';
const POINTS_ACTIVE_KEY = 'adherence_points_active_from';
const PHONE_BEFORE_KEY = 'adherence_phone_grace_before_sec';
const PHONE_AFTER_KEY = 'adherence_phone_grace_after_sec';
const COMPLIANCE_GREEN_KEY = 'adherence_compliance_green_min';
const COMPLIANCE_YELLOW_KEY = 'adherence_compliance_yellow_min';

/** Defaults, used when a row is missing or malformed. Match the migration seeds. */
export const DEFAULT_START = '2026-06-21';
export const DEFAULT_POINTS_ACTIVE = '2099-01-01';
export const DEFAULT_PHONE_BEFORE_SEC = 120;
export const DEFAULT_PHONE_AFTER_SEC = 60;
export const DEFAULT_COMPLIANCE_GREEN_MIN = 90;
export const DEFAULT_COMPLIANCE_YELLOW_MIN = 80;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real YYYY-MM-DD calendar date, so a typo can't reach the engine. */
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * The later of two YYYY-MM-DD dates. Raises a window's lower bound to the policy
 * start so nothing earlier is ever counted. String comparison is exact for
 * zero-padded ISO dates (see date-handling rule).
 */
export function floorFrom(from: string, start: string): string {
  return from < start ? start : from;
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

export async function getAdherenceStartDate(): Promise<string> {
  const value = await readConfig(START_KEY);
  return value && isValidDate(value) ? value : DEFAULT_START;
}

export async function setAdherenceStartDate(date: string): Promise<string> {
  if (!isValidDate(date)) throw new Error('Adherence start date must be a valid YYYY-MM-DD date');
  await writeConfig(
    START_KEY, date,
    'Adherence: earliest date scored. Breaks/lunches before this date are never scored or counted. Format YYYY-MM-DD.',
  );
  return date;
}

export async function getPointsActiveFrom(): Promise<string> {
  const value = await readConfig(POINTS_ACTIVE_KEY);
  return value && isValidDate(value) ? value : DEFAULT_POINTS_ACTIVE;
}

export async function setPointsActiveFrom(date: string): Promise<string> {
  if (!isValidDate(date)) throw new Error('Points-active date must be a valid YYYY-MM-DD date');
  await writeConfig(
    POINTS_ACTIVE_KEY, date,
    'Adherence: date points begin counting toward the discipline ladder. Before it, occurrences are report-only. Format YYYY-MM-DD.',
  );
  return date;
}

export interface PhoneGrace {
  beforeSec: number;
  afterSec: number;
}

function parseSeconds(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export async function getPhoneGrace(): Promise<PhoneGrace> {
  const [before, after] = await Promise.all([readConfig(PHONE_BEFORE_KEY), readConfig(PHONE_AFTER_KEY)]);
  return {
    beforeSec: parseSeconds(before, DEFAULT_PHONE_BEFORE_SEC),
    afterSec: parseSeconds(after, DEFAULT_PHONE_AFTER_SEC),
  };
}

export async function setPhoneGrace(beforeSec: number, afterSec: number): Promise<PhoneGrace> {
  if (!Number.isFinite(beforeSec) || beforeSec < 0 || !Number.isFinite(afterSec) || afterSec < 0) {
    throw new Error('Phone grace must be zero or more seconds');
  }
  await writeConfig(
    PHONE_BEFORE_KEY, String(Math.floor(beforeSec)),
    'Adherence: seconds the phone may go Break/Meal BEFORE the punched segment before it counts.',
  );
  await writeConfig(
    PHONE_AFTER_KEY, String(Math.floor(afterSec)),
    'Adherence: seconds the phone may stay Break/Meal AFTER the punched segment before it counts.',
  );
  return { beforeSec: Math.floor(beforeSec), afterSec: Math.floor(afterSec) };
}

/** Red/yellow/green cut-offs (percent) for the compliance columns. At or above
 * greenMin is green, at or above yellowMin is yellow, below is red. */
export interface ComplianceThresholds {
  greenMin: number;
  yellowMin: number;
}

function parsePct(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export async function getComplianceThresholds(): Promise<ComplianceThresholds> {
  const [green, yellow] = await Promise.all([
    readConfig(COMPLIANCE_GREEN_KEY),
    readConfig(COMPLIANCE_YELLOW_KEY),
  ]);
  return {
    greenMin: parsePct(green, DEFAULT_COMPLIANCE_GREEN_MIN),
    yellowMin: parsePct(yellow, DEFAULT_COMPLIANCE_YELLOW_MIN),
  };
}

export async function setComplianceThresholds(greenMin: number, yellowMin: number): Promise<ComplianceThresholds> {
  const okRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  if (!okRange(greenMin) || !okRange(yellowMin)) {
    throw new Error('Compliance thresholds must be between 0 and 100');
  }
  if (greenMin < yellowMin) {
    throw new Error('Green threshold must be at or above the yellow threshold');
  }
  await writeConfig(
    COMPLIANCE_GREEN_KEY, String(greenMin),
    'Adherence: compliance % at or above which the roster cell shows green.',
  );
  await writeConfig(
    COMPLIANCE_YELLOW_KEY, String(yellowMin),
    'Adherence: compliance % at or above which the roster cell shows yellow (below is red).',
  );
  return { greenMin, yellowMin };
}
