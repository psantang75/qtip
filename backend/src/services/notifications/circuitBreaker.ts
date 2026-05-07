import { mailConfig } from '../../config/environment';
import logger from '../../config/logger';

/**
 * System-wide circuit breaker. If we send more than
 * MAIL_GLOBAL_RATE_LIMIT emails in any 5-minute window, pause non-locked
 * templates and emit a one-shot system.circuit_tripped alert to admins.
 *
 * Locked / security templates (password reset, account locked,
 * write-up signature flow) bypass the breaker — they are critical
 * enough that we'd rather oversend than drop.
 *
 * The breaker auto-resets one window after the most recent send, so a
 * one-time spike doesn't permanently disable mail.
 */

const WINDOW_MS = 5 * 60 * 1000;
let timestamps: number[] = [];
let trippedAt: number | null = null;
let lastTripNotifiedAt = 0;

export interface CircuitState {
  tripped: boolean;
  count: number;
  trippedAt: number | null;
}

export function recordSend(): void {
  const now = Date.now();
  timestamps.push(now);
  prune(now);
  if (timestamps.length >= mailConfig.globalRateLimit && !trippedAt) {
    trippedAt = now;
    logger.error('[circuitBreaker] tripped', { count: timestamps.length, threshold: mailConfig.globalRateLimit });
  }
  if (trippedAt && now - trippedAt > WINDOW_MS && timestamps.length < mailConfig.globalRateLimit) {
    logger.info('[circuitBreaker] auto-reset', { uptimeMs: now - trippedAt });
    trippedAt = null;
  }
}

function prune(now: number): void {
  timestamps = timestamps.filter(ts => now - ts < WINDOW_MS);
}

export function isTripped(): boolean {
  prune(Date.now());
  return trippedAt !== null;
}

export function getState(): CircuitState {
  prune(Date.now());
  return { tripped: trippedAt !== null, count: timestamps.length, trippedAt };
}

/**
 * One-shot guard so we don't spam admins with circuit-tripped alerts
 * every 5 seconds while the breaker is open. Caller fires the alert
 * once when this returns true, then suppresses for a full window.
 */
export function shouldNotifyAdminsOnTrip(): boolean {
  const now = Date.now();
  if (!isTripped()) return false;
  if (now - lastTripNotifiedAt < WINDOW_MS) return false;
  lastTripNotifiedAt = now;
  return true;
}

export function _resetForTest(): void {
  timestamps = [];
  trippedAt = null;
  lastTripNotifiedAt = 0;
}
