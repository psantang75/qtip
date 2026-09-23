/**
 * Shared self-arming timer for the in-app job schedules.
 *
 * Extracted when the sales-plays miner needed the same treatment as the Missed
 * Opportunities review: both moved off PM2 `cron_restart` because PM2 launches
 * every one-shot app when the daemon starts, so each deploy silently fired them.
 * For an LLM job that meant unscheduled spend nobody could see.
 *
 * This owns only the timer mechanics — arming, re-arming, the crash guard, and
 * the re-entrancy guard. Each caller supplies its own "is it due, and do the
 * work" tick, because due-ness is job-specific (daily for grading, monthly for
 * mining) and is deliberately derived from run history rather than a stored
 * `next_run_at`, which makes it self-healing across restarts.
 *
 * Same setTimeout shape as KbIndexScheduler and DigestScheduler so operators
 * have one mental model for background work.
 */

import logger from '../config/logger';

export interface ScheduleLoop {
  /** Idempotent — a second call is a no-op while the loop is armed. */
  start(): Promise<void>;
  /** Used by tests and graceful shutdown. */
  stop(): void;
}

export interface ScheduleLoopOptions {
  /** Log prefix, e.g. '[MISSED OPPS SCHEDULER]'. */
  label: string;
  tickMs: number;
  /** Delay before the first tick, so HTTP health comes up before any real work. */
  bootDelayMs: number;
  /**
   * One-line summary for the boot log (e.g. the configured time). Read inside
   * the loop's own try/catch so a transient DB error can't prevent arming.
   */
  describe?: () => Promise<string>;
  /** Decide whether the job is due and, if so, run it. */
  tick: () => Promise<void>;
}

export function createScheduleLoop(options: ScheduleLoopOptions): ScheduleLoop {
  const { label, tickMs, bootDelayMs, describe, tick } = options;

  let timeoutHandle: NodeJS.Timeout | null = null;
  let running = false;

  /**
   * The `.catch()` is the crash guard: the tick runs as a floating promise, and
   * an unhandled rejection calls `process.exit(1)` in dev. Anything escaping
   * `runTick` is logged here instead of taking the API process down.
   */
  const arm = (delayMs: number): void => {
    timeoutHandle = setTimeout(() => {
      void runTick().catch((err) => {
        logger.error(`${label} tick chain error: ${message(err)}`);
      });
    }, delayMs);
  };

  const runTick = async (): Promise<void> => {
    // Skipped rather than queued: the work is minutes long and idempotent, so a
    // still-running tick means the next one has nothing useful to add.
    if (running) {
      arm(tickMs);
      return;
    }
    running = true;
    try {
      await tick();
    } catch (err) {
      // Re-armed in `finally` regardless: one bad tick (a DB blip, a provider
      // outage) must not end the schedule for the life of the process.
      logger.error(`${label} tick failed: ${message(err)}`);
    } finally {
      running = false;
      arm(tickMs);
    }
  };

  return {
    async start(): Promise<void> {
      if (timeoutHandle) return;
      // Armed before the summary is read: that read is a convenience for the
      // boot log, and a transient failure must not leave the loop unarmed until
      // the next restart.
      arm(bootDelayMs);
      try {
        const summary = describe ? await describe() : 'started';
        logger.info(`${label} ${summary}`);
      } catch (err) {
        logger.error(`${label} started, but reading the schedule failed: ${message(err)}`);
      }
    },

    stop(): void {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = null;
    },
  };
}

const message = (err: unknown): string => (err as Error)?.message ?? String(err);
