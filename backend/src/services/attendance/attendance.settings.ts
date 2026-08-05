/**
 * attendance.settings — the one admin-tunable value that is not an effective-dated
 * band: the date the point policy began.
 *
 * Punch and schedule history predates the policy, so without a floor the rolling
 * window would charge people points for days before the policy existed. The read
 * layer floors its window to this date and the engine refuses to score before it.
 *
 * Reuses the existing `ie_config` KV table exactly like unlock.config.ts and
 * SystemSettingsService — string-typed, validated on both read and write so a
 * hand-edited row can never feed the engine a garbage date.
 *
 * Key owned by this module (seeded by 20260805140000_add_attendance_points_start):
 *
 *   attendance_points_start_date  the day the point policy took effect. Days
 *                                 before it are never scored or counted.
 */
import prisma from '../../config/prisma';

const POINTS_START_KEY = 'attendance_points_start_date';

/** The day the policy went live. Used when the row is missing or malformed. */
export const DEFAULT_POINTS_START = '2026-06-21';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real YYYY-MM-DD calendar date, so a typo can't reach the engine. */
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * The later of two YYYY-MM-DD dates. The whole point of this module: raise a
 * window's lower bound to the policy start so nothing earlier is ever counted.
 * String comparison is exact for zero-padded ISO dates (see date-handling rule).
 */
export function floorFrom(from: string, start: string): string {
  return from < start ? start : from;
}

/** The configured policy start date, falling back to the default when unset/invalid. */
export async function getPointsStartDate(): Promise<string> {
  const row = await prisma.ieConfig.findUnique({ where: { config_key: POINTS_START_KEY } });
  const value = row?.config_value;
  return value && isValidDate(value) ? value : DEFAULT_POINTS_START;
}

/**
 * Persist the policy start date. Returns the stored value so the admin UI can echo
 * it back without a second round-trip. Rejects a malformed date rather than
 * silently ignoring it, because a bad value here would misprice everyone's points.
 */
export async function setPointsStartDate(date: string): Promise<string> {
  if (!isValidDate(date)) {
    throw new Error('Points start date must be a valid YYYY-MM-DD date');
  }
  await prisma.ieConfig.upsert({
    where: { config_key: POINTS_START_KEY },
    create: {
      config_key: POINTS_START_KEY,
      config_value: date,
      description:
        'Attendance points: policy start date. Occurrences before this date are never scored or counted even though earlier punch/schedule history exists. Format YYYY-MM-DD.',
    },
    update: { config_value: date },
  });
  return date;
}
