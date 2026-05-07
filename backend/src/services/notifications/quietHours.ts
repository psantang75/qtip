import { mailConfig } from '../../config/environment';

/**
 * Returns true when the current time falls within the configured quiet
 * window for the configured timezone. Locked templates bypass; everything
 * else either skips or holds for the next window (caller's choice — we
 * just signal whether quiet hours are active).
 *
 * Format: "23-06" means 23:00 through 05:59 inclusive. Wraps midnight.
 */

export function isQuietHour(now: Date = new Date()): boolean {
  const window = (mailConfig.quietHours || '').trim();
  if (!window || !/^\d{1,2}-\d{1,2}$/.test(window)) return false;
  const [startStr, endStr] = window.split('-');
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;

  const tz = mailConfig.timezone;
  const localHour = parseInt(
    now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }),
    10,
  );
  if (start < end) return localHour >= start && localHour < end;
  return localHour >= start || localHour < end;
}
