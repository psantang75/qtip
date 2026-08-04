/**
 * Admin-tunable guardrails for the admin unlock / reopen feature.
 *
 * Reuses the existing `ie_config` KV table exactly like
 * `SystemSettingsService` does for the KB scheduler — string-typed values,
 * clamped on both read and write so a hand-edited row can never put the
 * unlock service into an unsafe state.
 *
 * Keys owned by this module (seeded by 20260804210000_add_record_unlock):
 *
 *   unlock_window_days     days after submit/resolve a record may be reopened
 *                          without a break-glass confirm. Default 30.
 *   unlock_relock_days     days a reopened record may stay open before the
 *                          sweep restores it. Default 3.
 *   unlock_max_per_record  hard cap on reopens for one record. Default 2.
 */

import prisma from '../../config/prisma';

const WINDOW_KEY = 'unlock_window_days';
const RELOCK_KEY = 'unlock_relock_days';
const MAX_KEY = 'unlock_max_per_record';

export const UNLOCK_DEFAULT_WINDOW_DAYS = 30;
export const UNLOCK_MIN_WINDOW_DAYS = 1;
export const UNLOCK_MAX_WINDOW_DAYS = 365;

export const UNLOCK_DEFAULT_RELOCK_DAYS = 3;
export const UNLOCK_MIN_RELOCK_DAYS = 1;
export const UNLOCK_MAX_RELOCK_DAYS = 30;

export const UNLOCK_DEFAULT_MAX_PER_RECORD = 2;
export const UNLOCK_MIN_MAX_PER_RECORD = 1;
export const UNLOCK_MAX_MAX_PER_RECORD = 10;

export interface UnlockSettings {
  window_days: number;
  relock_days: number;
  max_per_record: number;
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

async function getNumber(key: string, min: number, max: number, fallback: number): Promise<number> {
  const row = await prisma.ieConfig.findUnique({ where: { config_key: key } });
  if (!row?.config_value) return fallback;
  return clamp(Number(row.config_value), min, max, fallback);
}

async function setNumber(
  key: string,
  value: number,
  min: number,
  max: number,
  fallback: number,
  description: string,
): Promise<number> {
  const clamped = clamp(value, min, max, fallback);
  await prisma.ieConfig.upsert({
    where: { config_key: key },
    create: { config_key: key, config_value: String(clamped), description },
    update: { config_value: String(clamped) },
  });
  return clamped;
}

/** Composite getter — the unlock service reads all three at once. */
export async function getUnlockSettings(): Promise<UnlockSettings> {
  const [window_days, relock_days, max_per_record] = await Promise.all([
    getNumber(WINDOW_KEY, UNLOCK_MIN_WINDOW_DAYS, UNLOCK_MAX_WINDOW_DAYS, UNLOCK_DEFAULT_WINDOW_DAYS),
    getNumber(RELOCK_KEY, UNLOCK_MIN_RELOCK_DAYS, UNLOCK_MAX_RELOCK_DAYS, UNLOCK_DEFAULT_RELOCK_DAYS),
    getNumber(MAX_KEY, UNLOCK_MIN_MAX_PER_RECORD, UNLOCK_MAX_MAX_PER_RECORD, UNLOCK_DEFAULT_MAX_PER_RECORD),
  ]);
  return { window_days, relock_days, max_per_record };
}

/**
 * Persist any subset of the three settings. Returns the values actually
 * stored (after clamping) so the admin UI can echo them back without a
 * second round-trip.
 */
export async function setUnlockSettings(patch: Partial<UnlockSettings>): Promise<UnlockSettings> {
  if (patch.window_days !== undefined) {
    await setNumber(
      WINDOW_KEY,
      patch.window_days,
      UNLOCK_MIN_WINDOW_DAYS,
      UNLOCK_MAX_WINDOW_DAYS,
      UNLOCK_DEFAULT_WINDOW_DAYS,
      'Admin unlock: days after submit/resolve within which a record may be reopened without a break-glass confirm. Range 1..365.',
    );
  }
  if (patch.relock_days !== undefined) {
    await setNumber(
      RELOCK_KEY,
      patch.relock_days,
      UNLOCK_MIN_RELOCK_DAYS,
      UNLOCK_MAX_RELOCK_DAYS,
      UNLOCK_DEFAULT_RELOCK_DAYS,
      'Admin unlock: days a reopened record may stay open before the sweep automatically restores it. Range 1..30.',
    );
  }
  if (patch.max_per_record !== undefined) {
    await setNumber(
      MAX_KEY,
      patch.max_per_record,
      UNLOCK_MIN_MAX_PER_RECORD,
      UNLOCK_MAX_MAX_PER_RECORD,
      UNLOCK_DEFAULT_MAX_PER_RECORD,
      'Admin unlock: hard cap on how many times a single review or dispute may be reopened. Range 1..10.',
    );
  }
  return getUnlockSettings();
}
