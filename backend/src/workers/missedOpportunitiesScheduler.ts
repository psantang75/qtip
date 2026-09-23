/**
 * Daily scheduler for the Missed Opportunities review.
 *
 * Replaces the `ie-missed-opportunities` PM2 cron, which fired invisibly: there
 * was no way to see the schedule, pause it, or tell a skipped day from a failed
 * one without shelling into the box, and PM2 launched it on every container
 * start as well as on its cron. Cadence now lives in `ie_config`
 * (`missed_opps_schedule_*`, editable on the report's Settings tab) and every
 * decision made here is logged.
 *
 * Due rule: once the configured hour has passed, grade the prior business day
 * unless a run row for it already exists. Deriving "due" from
 * `ie_missed_opportunity_run` rather than a `next_run_at` column makes this
 * self-healing — a restart or an outage during the window still gets the day
 * graded on a later tick, and a day can never be graded twice.
 *
 * A failed day is deliberately NOT retried automatically. The failure is on the
 * report and in the ingestion log, and an admin re-runs it from Settings; that
 * keeps a persistently failing day from re-spending the LLM budget every tick.
 */

import logger from '../config/logger';
import { getRunStatus } from '../services/insights/missedOpportunities/reportSupport';
import { getMissedOpportunitySettings } from '../services/insights/missedOpportunities/settings';
import { resolvePriorBusinessDay } from '../services/insights/missedOpportunities/workerSupport';
import { MissedOpportunitiesWorker } from './MissedOpportunitiesWorker';
import { createScheduleLoop } from './scheduleLoop';

const SERVICE = '[MISSED OPPS SCHEDULER]';

/**
 * Checked four times an hour rather than armed for an exact instant, so the run
 * still happens if the process was down at the configured hour.
 */
const TICK_MS = 15 * 60_000;

/** Let the HTTP server become healthy before a multi-minute grading run starts. */
const BOOT_DELAY_MS = 90_000;

const hh = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

async function gradeIfDue(): Promise<void> {
  const { scheduleEnabled, scheduleHour } = await getMissedOpportunitySettings();
  if (!scheduleEnabled) {
    logger.debug(`${SERVICE} skipped — schedule disabled in settings`);
    return;
  }

  // Local hours are the business hours: the process timezone is pinned to
  // America/New_York in config/timezone.ts, which is also how
  // SourceReportDispatcher reads its run-only-hours window.
  const hour = new Date().getHours();
  if (hour < scheduleHour) {
    logger.debug(`${SERVICE} skipped — before ${hh(scheduleHour)} (now ${hh(hour)})`);
    return;
  }

  const runDate = await resolvePriorBusinessDay();
  const existing = await getRunStatus(runDate);
  if (existing?.status) {
    logger.debug(`${SERVICE} skipped — ${runDate} already ${existing.status}`);
    return;
  }

  logger.info(`${SERVICE} grading ${runDate} (due after ${hh(scheduleHour)}, now ${hh(hour)})`);
  // The date is passed explicitly so the run row and this log agree on the day
  // even if the tick straddles midnight.
  await new MissedOpportunitiesWorker(runDate).run();
  logger.info(`${SERVICE} finished ${runDate}`);
}

const loop = createScheduleLoop({
  label: SERVICE,
  tickMs: TICK_MS,
  bootDelayMs: BOOT_DELAY_MS,
  describe: async () => {
    const { scheduleEnabled, scheduleHour } = await getMissedOpportunitySettings();
    return `started — ${
      scheduleEnabled ? `prior business day graded after ${hh(scheduleHour)}` : 'schedule disabled'
    }, checking every ${TICK_MS / 60_000} min`;
  },
  tick: gradeIfDue,
});

export const startMissedOpportunitiesScheduler = loop.start;
export const stopMissedOpportunitiesScheduler = loop.stop;
