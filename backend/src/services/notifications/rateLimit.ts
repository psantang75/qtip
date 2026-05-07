/**
 * In-memory per-recipient rate limit. Catches runaway loops (a controller
 * that fires the same notify() 10,000 times due to a bug) before they
 * can reach the SMTP relay.
 *
 * 30 emails per recipient per 5-minute sliding window. Counter resets
 * on process restart — that's fine, the goal is to interrupt a bug in
 * the same uptime window, not to enforce a multi-day cap.
 */

const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 30;

const buckets = new Map<string, number[]>();

export function shouldRateLimit(toEmail: string): boolean {
  const now = Date.now();
  const arr = buckets.get(toEmail) ?? [];
  const fresh = arr.filter(ts => now - ts < WINDOW_MS);
  if (fresh.length >= MAX_PER_WINDOW) {
    buckets.set(toEmail, fresh);
    return true;
  }
  fresh.push(now);
  buckets.set(toEmail, fresh);
  return false;
}

export function _resetForTest(): void {
  buckets.clear();
}
