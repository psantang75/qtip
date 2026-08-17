import logger from '../config/logger';

/**
 * Environment kill-switch for the scheduled Insights workers.
 *
 * The PM2 cron entrypoints (run-dept-sync, run-emp-sync, run-calendar-sync,
 * run-rollup, run-partition-manager, run-source-dispatch) call this before
 * doing any work. When `INSIGHTS_AUTOMATION_ENABLED=false` the process exits
 * cleanly (code 0) without touching any source or warehouse.
 *
 * Default is ENABLED: the guard only trips on the exact string "false", so an
 * unset or misspelled value leaves automation running. This keeps prod safe if
 * the var is ever missing.
 *
 * Scope is intentionally the scheduled entrypoints only. Manual paths — the
 * "Run now" API (runSourceReportNow) and the run-source-backfill CLI — build
 * the worker directly and are NOT gated, so an environment with automation off
 * can still be refreshed on demand.
 */
export function isAutomationEnabled(): boolean {
  return process.env.INSIGHTS_AUTOMATION_ENABLED !== 'false';
}

/** Exit the current worker process if scheduled automation is disabled. */
export function exitIfAutomationDisabled(workerName: string): void {
  if (!isAutomationEnabled()) {
    logger.info(
      `[${workerName}] scheduled automation disabled (INSIGHTS_AUTOMATION_ENABLED=false) — skipping run`,
    );
    process.exit(0);
  }
}
