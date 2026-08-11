/**
 * One-time backfill for ie_ticket_task_daily — reconstructs the daily 8am (ET)
 * per-agent Current / Due Today / Past Due counts from the CRM's audit trail
 * (tblTaskHistory / tblTicketStatusHistory), which is complete back to
 * 2023-04-25. CRM access is READ-ONLY; writes go only to local bf_tt_* work
 * tables and ie_ticket_task_daily (is_backfilled = 1 rows only — live captures
 * are never touched, so this is safe to run after the RollupWorker capture is
 * already in production).
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/ticket-task-daily-backfill/index.ts [options]
 *
 * Options:
 *   --validate        Dry-run: reconstruct today + the last 7 days and print
 *                     them next to the live report's current totals. Writes
 *                     nothing to ie_ticket_task_daily. Run this FIRST.
 *   --from=YYYY-MM-DD --to=YYYY-MM-DD   Backfill range (default 2023-04-26 ..
 *                     yesterday ET). Days already captured live are skipped.
 *   --skip-extract    Reuse existing bf_tt_* work tables (resume/re-run).
 *   --force           Recompute days that already have backfilled rows.
 *   --drop-work       Drop the bf_tt_* work tables after a successful run.
 *   --productivity    Backfill ie_ticket_task_productivity_daily (beginning /
 *                     new assigned / touched / closed) instead of the bucket
 *                     snapshot. Beginning is read from ie_ticket_task_daily, so
 *                     run the bucket backfill FIRST. Honors --from/--to/--force/
 *                     --validate/--skip-extract just like the bucket backfill.
 */
import 'dotenv/config';
import pool from '../../config/database';
import { createWorkTables, dropWorkTables, runExtraction } from './extract';
import { backfillDay, reconstructDayTotals, liveReportTotals, productivityDay, reconstructProductivityTotals } from './aggregate';

const DEFAULT_FROM = '2023-04-26'; // first full day covered by tblTaskHistory (starts 2023-04-25)

/** Today's calendar date in the business timezone (ET). */
function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** YYYY-MM-DD + delta days, via pure component arithmetic (no tz involvement). */
function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function getArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const fmt = (t: { current: number; dueToday: number; pastDue: number }): string =>
  `current=${t.current} dueToday=${t.dueToday} pastDue=${t.pastDue}`;

async function validate(): Promise<void> {
  const today = etToday();
  console.log('\n=== VALIDATION (dry run — nothing is written) ===');
  console.log('Live report totals right now (ie_fact_ticket_task vs CURDATE()):');
  const live = await liveReportTotals();
  for (const area of ['sales', 'csr'] as const) console.log(`  live  ${area.padEnd(5)} ${fmt(live[area])}`);

  console.log(`\nReconstructed from CRM history (as of 8am ET each day):`);
  for (let i = 7; i >= 0; i--) {
    const day = addDays(today, -i);
    const rec = await reconstructDayTotals(day);
    for (const area of ['sales', 'csr'] as const) {
      console.log(`  ${day} ${area.padEnd(5)} ${fmt(rec[area])}`);
    }
  }
  console.log(
    '\nNote: the live totals reflect NOW (and drift during the day as due dates\n' +
    "roll and work completes); today's 8am reconstruction should be close but\n" +
    'not identical unless this runs right at 8am. Compare magnitude and shape.',
  );
}

const fmtProd = (t: { beginning: number; newAssigned: number; touched: number; closed: number }): string =>
  `beginning=${t.beginning} new=${t.newAssigned} touched=${t.touched} closed=${t.closed}`;

/** Dry-run the productivity reconstruction for the last 8 days (nothing written). */
async function validateProductivity(): Promise<void> {
  const today = etToday();
  console.log('\n=== PRODUCTIVITY VALIDATION (dry run — nothing is written) ===');
  console.log('Reconstructed per-area productivity (as of 8am ET each day; sales split by segment):');
  for (let i = 8; i >= 1; i--) {
    const day = addDays(today, -i);
    const rec = await reconstructProductivityTotals(day);
    for (const k of ['sales', 'sales:contact_manager', 'sales:other', 'csr'] as const) {
      if (rec[k]) console.log(`  ${day} ${k.padEnd(22)} ${fmtProd(rec[k])}`);
    }
  }
}

async function run(): Promise<void> {
  const from = getArg('from') ?? DEFAULT_FROM;
  const to = getArg('to') ?? addDays(etToday(), -1);
  const force = hasFlag('force');
  const productivity = hasFlag('productivity');

  if (hasFlag('skip-extract')) {
    console.log('Skipping extraction (reusing bf_tt_* work tables).');
  } else {
    await runExtraction(from);
  }

  if (hasFlag('validate')) {
    if (productivity) await validateProductivity();
    else await validate();
    return;
  }

  const label = productivity ? 'productivity' : 'bucket-snapshot';
  console.log(`\nBackfilling ${label} ${from} .. ${to} (force=${force})...`);
  let done = 0;
  let skipped = 0;
  const started = Date.now();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const wrote = productivity ? await productivityDay(day, force) : await backfillDay(day, force);
    if (wrote) done++;
    else skipped++;
    if ((done + skipped) % 30 === 0) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`  ...${day} (${done} written, ${skipped} skipped, ${mins}m elapsed)`);
    }
  }
  console.log(`Backfill complete: ${done} days written, ${skipped} skipped.`);

  if (hasFlag('drop-work')) {
    await dropWorkTables();
    console.log('Dropped bf_tt_* work tables.');
  }
}

(async () => {
  try {
    await createWorkTables();
    await run();
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
