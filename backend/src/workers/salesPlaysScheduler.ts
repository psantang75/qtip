/**
 * Monthly scheduler for the sales-plays miner.
 *
 * Replaces the `ie-sales-plays-miner` PM2 cron. That cron was set to the 1st of
 * the month, but PM2 also launches every one-shot app when the daemon starts, so
 * the miner actually ran on each container start — five times in one week of
 * deploys, none of them on the intended schedule. Because it is an LLM job, that
 * was real spend nobody could see, and it quietly advanced
 * `missed_opps_plays_last_mined`, leaving the genuine monthly run with nothing
 * to do.
 *
 * Due rule: on or after the configured day of the month, once the configured
 * hour has passed, mine unless the miner has already run this calendar month.
 * "Already run" is read from `ie_ingestion_log` rather than a stored
 * `next_run_at`, so a restart mid-month cannot cause a second mine, and a month
 * missed entirely because the process was down is still picked up late.
 */

import pool from '../config/database';
import type { RowDataPacket } from 'mysql2';
import logger from '../config/logger';
import { getSalesPlaysSettings } from '../services/insights/missedOpportunities/salesPlays/settings';
import { SalesPlaysMinerWorker } from './SalesPlaysMinerWorker';
import { createScheduleLoop } from './scheduleLoop';

const SERVICE = '[SALES PLAYS SCHEDULER]';
const WORKER_NAME = 'SalesPlaysMinerWorker';

/**
 * Hourly is ample for a monthly job, and keeps the window wide enough that a
 * restart around the scheduled hour does not skip the month.
 */
const TICK_MS = 60 * 60_000;

/**
 * Longer than the grading scheduler's so a deploy does not start two LLM jobs at
 * once — mining is the heavier of the two.
 */
const BOOT_DELAY_MS = 5 * 60_000;

const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** Whether the miner already has a run row in the current calendar month. */
async function minedThisMonth(now: Date): Promise<boolean> {
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM ie_ingestion_log
      WHERE worker_name = ? AND run_started_at >= ?
      LIMIT 1`,
    [WORKER_NAME, `${monthStart} 00:00:00`],
  );
  return rows.length > 0;
}

async function mineIfDue(): Promise<void> {
  const { enabled, scheduleDay, scheduleHour } = await getSalesPlaysSettings();
  if (!enabled) {
    logger.debug(`${SERVICE} skipped — the plays learning loop is off`);
    return;
  }

  // Local parts are the business date/hour: the process timezone is pinned to
  // America/New_York in config/timezone.ts.
  const now = new Date();
  if (now.getDate() < scheduleDay) {
    logger.debug(`${SERVICE} skipped — before day ${scheduleDay} (today is ${now.getDate()})`);
    return;
  }
  if (now.getHours() < scheduleHour) {
    logger.debug(`${SERVICE} skipped — before ${hh(scheduleHour)} on the scheduled day`);
    return;
  }
  if (await minedThisMonth(now)) {
    logger.debug(`${SERVICE} skipped — already mined this month`);
    return;
  }

  logger.info(`${SERVICE} mining (due day ${scheduleDay} after ${hh(scheduleHour)})`);
  await new SalesPlaysMinerWorker().run();
  logger.info(`${SERVICE} mine finished`);
}

const loop = createScheduleLoop({
  label: SERVICE,
  tickMs: TICK_MS,
  bootDelayMs: BOOT_DELAY_MS,
  describe: async () => {
    const { enabled, scheduleDay, scheduleHour } = await getSalesPlaysSettings();
    return `started — ${
      enabled ? `mining on day ${scheduleDay} after ${hh(scheduleHour)}` : 'learning loop off'
    }, checking every ${TICK_MS / 60_000} min`;
  },
  tick: mineIfDue,
});

export const startSalesPlaysScheduler = loop.start;
export const stopSalesPlaysScheduler = loop.stop;
