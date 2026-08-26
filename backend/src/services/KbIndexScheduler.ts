/**
 * Background scheduler for the BookStack KB crawl + procedure parse.
 *
 * Until this scheduler existed, the KB index (embeddings AND the
 * parsed Approach structure under `kb_pages_meta.qtip_steps`) only
 * refreshed when an operator manually ran `npx ts-node
 * scripts/kb-crawl.ts`. That meant BookStack edits to a playbook
 * silently drifted from what the AI Reviewer actually graded
 * against. This scheduler closes that gap by ticking on a configurable
 * cadence (admin UI -> /api/admin/system-settings/kb-scheduler) and
 * pushing crawl summaries into `ie_config` so the admin card can show
 * "last run X minutes ago, N pages updated."
 *
 * Same setInterval/setTimeout shape as DigestScheduler so operators
 * have one mental model for background workers.
 *
 * Failure policy: a crawl error never crashes the scheduler. The
 * failure is recorded into the run history (so the UI can show it),
 * logged at error level, and the next tick proceeds normally.
 */

import logger from '../config/logger';
import kbIndexService from './KbIndexService';
import type { CrawlSummary } from './KbIndexService';
import {
  getKbIndexIntervalMin,
  getKbIndexLastRun,
  recordKbIndexRun,
  type KbIndexRunRecord,
} from './SystemSettingsService';

/** Wait this long after boot before the first tick fires. Lets the
 *  HTTP server become healthy without a multi-minute crawl tying up
 *  the boot IIFE. */
const BOOT_DELAY_MS = 60_000;

/** Fallback cadence when the interval read from `ie_config` fails (transient
 *  DB blip). Only used to keep the scheduler self-arming; the next tick
 *  re-reads the real value. Mirrors `getKbIndexIntervalMin()`'s default. */
const DEFAULT_INTERVAL_MIN = 60;

let timeoutHandle: NodeJS.Timeout | null = null;
let running = false;

/**
 * Arm the next tick. The `.catch()` is the crash guard: the tick runs as a
 * floating promise, and in dev an unhandled rejection calls `process.exit(1)`
 * (see index.ts). Anything that escapes `scheduleNext` (e.g. a Prisma read)
 * is logged here instead of taking the whole API process down — same pattern
 * as DigestScheduler.
 */
function armNextTick(delayMs: number): void {
  timeoutHandle = setTimeout(() => {
    void scheduleNext('scheduler').catch((err) => {
      logger.error(`[KB INDEX SCHEDULER] tick chain error: ${(err as Error)?.message ?? String(err)}`);
    });
  }, delayMs);
}

/**
 * Start the scheduler. Idempotent — safe to call multiple times
 * (subsequent calls are no-ops). Reads the interval from `ie_config`
 * on every tick so a UI edit takes effect within one cycle.
 */
export async function startKbIndexScheduler(): Promise<void> {
  if (timeoutHandle) return;
  if (!kbIndexService.isConfigured()) {
    logger.warn(
      '[KB INDEX SCHEDULER] not started — KbIndexService is not configured (missing OPENAI_API_KEY or BookStack creds).'
    );
    return;
  }
  const interval = await getKbIndexIntervalMin();
  const lastRun = await getKbIndexLastRun();
  logger.info(
    `[KB INDEX SCHEDULER] started, tick every ${interval} min, last run ${lastRun?.ran_at ?? 'never'}`
  );
  // First tick on a short delay so HTTP server health is up first.
  armNextTick(BOOT_DELAY_MS);
}

/**
 * Manually trigger a crawl outside the tick cadence. Used by the
 * admin UI's "Run now" button. Skips quietly when a crawl is already
 * in progress to avoid concurrent crawls hammering BookStack.
 */
export async function runKbIndexNow(): Promise<KbIndexRunRecord | { skipped: true; reason: string }> {
  if (running) {
    return { skipped: true, reason: 'A crawl is already in progress; refresh the page in a minute.' };
  }
  if (!kbIndexService.isConfigured()) {
    return { skipped: true, reason: 'KbIndexService is not configured.' };
  }
  return executeCrawl('manual');
}

/** Stop the scheduler. Used by tests and graceful shutdown. */
export function stopKbIndexScheduler(): void {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutHandle = null;
}

/**
 * Run a crawl, then schedule the next tick using whatever interval
 * is in `ie_config` right now. Re-read of the interval on every tick
 * means UI edits propagate within one cycle without needing a
 * scheduler restart.
 */
async function scheduleNext(triggeredBy: 'scheduler' | 'boot'): Promise<void> {
  await executeCrawl(triggeredBy);
  // Read the current interval, but never let a transient DB error here
  // escape as an unhandled rejection (which would crash the dev process).
  // Fall back to the default cadence so the scheduler keeps ticking; the
  // next tick re-reads the real value.
  let interval = DEFAULT_INTERVAL_MIN;
  try {
    interval = await getKbIndexIntervalMin();
  } catch (err) {
    logger.error(
      `[KB INDEX SCHEDULER] interval read failed, using ${DEFAULT_INTERVAL_MIN}m default: ${(err as Error)?.message ?? String(err)}`
    );
  }
  // Re-arm even if executeCrawl threw — the failure is already
  // recorded; we still want to try again on the next tick.
  armNextTick(interval * 60_000);
}

async function executeCrawl(
  triggeredBy: 'scheduler' | 'manual' | 'boot'
): Promise<KbIndexRunRecord> {
  if (running) {
    // Re-entrancy guard. In practice the tick spacing makes this
    // unreachable, but a future operator stacking ticks (e.g.
    // shortening the interval to a minute during testing) could hit
    // it. Return a no-op record rather than blocking.
    const noop: KbIndexRunRecord = {
      pages_total: 0,
      pages_new: 0,
      pages_updated: 0,
      pages_unchanged: 0,
      pages_skipped: 0,
      pages_errored: 0,
      approx_cost_usd: 0,
      elapsed_ms: 0,
      ran_at: new Date().toISOString(),
      triggered_by: triggeredBy,
    };
    return noop;
  }
  running = true;
  const started = Date.now();
  try {
    const summary: CrawlSummary = await kbIndexService.crawlAndIndex({ force: false });
    const record: KbIndexRunRecord = {
      ...summary,
      ran_at: new Date().toISOString(),
      triggered_by: triggeredBy,
    };
    await recordKbIndexRun(record);
    logger.info(
      `[KB INDEX SCHEDULER] tick complete (trigger=${triggeredBy}): ` +
        `total=${summary.pages_total} new=${summary.pages_new} updated=${summary.pages_updated} ` +
        `unchanged=${summary.pages_unchanged} skipped=${summary.pages_skipped} errored=${summary.pages_errored} ` +
        `cost=$${summary.approx_cost_usd.toFixed(4)} elapsed=${summary.elapsed_ms}ms`
    );
    return record;
  } catch (err) {
    const elapsed = Date.now() - started;
    const message = (err as Error)?.message ?? String(err);
    logger.error(`[KB INDEX SCHEDULER] tick failed (trigger=${triggeredBy}): ${message}`);
    const failed: KbIndexRunRecord = {
      pages_total: 0,
      pages_new: 0,
      pages_updated: 0,
      pages_unchanged: 0,
      pages_skipped: 0,
      pages_errored: 1,
      approx_cost_usd: 0,
      elapsed_ms: elapsed,
      ran_at: new Date().toISOString(),
      triggered_by: triggeredBy,
    };
    await recordKbIndexRun(failed).catch(() => {
      // Don't recurse into another error if the record write itself
      // fails — just swallow; the logger.error above is the audit
      // trail of last resort.
    });
    return failed;
  } finally {
    running = false;
  }
}
