import dotenv from 'dotenv';
import path from 'path';
// Resolve .env relative to the compiled file so loading works regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import logger from '../config/logger';
import { DeskTimeSyncWorker, monthRequests } from './DeskTimeSyncWorker';
import { deskTimeService } from '../services/desktime/DeskTimeService';

const SERVICE = 'DeskTimeBackfill';

/**
 * On-demand DeskTime backfill over an explicit range, one `period=month`
 * request per calendar month (sequential). Idempotent, so re-running a range
 * is always safe. Manual path — not gated by INSIGHTS_AUTOMATION_ENABLED.
 *
 * Usage:
 *   node dist/workers/run-desktime-backfill.js <from YYYY-MM-DD> <to YYYY-MM-DD>
 *
 * DeskTime history for this account starts 2026-03-02:
 *   node dist/workers/run-desktime-backfill.js 2026-03-01 2026-09-24
 */
async function main(): Promise<void> {
  const [from, to] = process.argv.slice(2);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !iso.test(from) || !iso.test(to) || from > to) {
    logger.error('Usage: run-desktime-backfill <from YYYY-MM-DD> <to YYYY-MM-DD>', { service: SERVICE });
    process.exit(2);
  }
  if (!deskTimeService.isConfigured()) {
    logger.error('DESKTIME_API_KEY is not set', { service: SERVICE });
    process.exit(2);
  }

  const requests = monthRequests(from, to);
  logger.info('Backfill starting', { service: SERVICE, from, to, months: requests.length });
  const res = await new DeskTimeSyncWorker(requests, { from, to }).run();
  if (!res) {
    logger.warn('Backfill skipped: desktime-sync lock is held by another run', { service: SERVICE });
    process.exit(1);
  }
  logger.info('Backfill complete', { service: SERVICE, rowsExtracted: res.rowsExtracted, rowsLoaded: res.rowsLoaded });
}

main().then(() => process.exit(0)).catch((err) => {
  logger.error('Backfill failed', { service: SERVICE, error: err?.message });
  process.exit(1);
});
