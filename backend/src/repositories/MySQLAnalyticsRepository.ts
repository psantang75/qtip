/**
 * Backward-compatible re-export shim.
 *
 * The original 1,748-line `MySQLAnalyticsRepository` god class was
 * decomposed into focused per-method modules under
 * `backend/src/repositories/analytics/` during pre-production
 * cleanup item #29. Existing import paths continue to work via this
 * shim — all new code should import from the modular location.
 *
 * @see backend/src/repositories/analytics/MySQLAnalyticsRepository.ts
 */
export { MySQLAnalyticsRepository } from './analytics'
