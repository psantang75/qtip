/**
 * AI spend rollup over `ai_call_logs` — what every LLM feature cost, by day and
 * by job.
 *
 * Why this exists: until now the only spend visible in the app was the AI
 * Reviewer's month-to-date budget gauge and a per-run figure on the Missed
 * Opportunities report. Nothing showed what a background worker had spent, which
 * is how a miner firing on every deploy went unnoticed for a week.
 *
 * IMPORTANT — these are estimates, and they read HIGH. `ai_call_logs.tokens_in`
 * is the total input for a call, and the prompt-cache split that `withCallLog`
 * uses to price the call is not persisted (see aiCallLogger). Recomputing from
 * the stored total therefore bills every cached token at the full input rate,
 * where the real charge for a cache read is a tenth of that. Treat the numbers
 * as an upper bound — on prod the Missed Opportunities estimate reads roughly
 * 3-4x its real charge, because its prompt is heavily cached.
 *
 * Where a job banks its own exact cost we surface that too, so the biggest line
 * isn't a false alarm: `ie_missed_opportunity_run.usd_cost` is the figure to
 * trust for that job. Making the estimate itself exact for every job would need
 * cache-token columns on `ai_call_logs`.
 *
 * Rates come from aiCostEstimator, the one pricing table in the codebase, so
 * this view can never drift from what the callers themselves charge.
 */

import type { RowDataPacket } from 'mysql2';
import pool from '../../config/database';
import { estimateUsdCost } from '../aiCostEstimator';

export interface AiSpendRow {
  /** Business-timezone date (YYYY-MM-DD). */
  day: string;
  purpose: string;
  model: string;
  calls: number;
  failedCalls: number;
  tokensIn: number;
  tokensOut: number;
  estimatedUsd: number;
}

export interface AiSpendTotal {
  purpose: string;
  calls: number;
  estimatedUsd: number;
  /**
   * The exact charge, where the job records one of its own. Only Missed
   * Opportunities does today, and its estimate reads roughly 3-4x high because
   * its prompt is heavily cached — so showing the estimate alone would raise a
   * false alarm on the biggest line.
   */
  recordedUsd: number | null;
}

export interface AiSpendRollup {
  windowDays: number;
  totalEstimatedUsd: number;
  /** Sum of the exact figures, for the share of spend that records one. */
  totalRecordedUsd: number | null;
  totalCalls: number;
  byPurpose: AiSpendTotal[];
  rows: AiSpendRow[];
  /**
   * Flags that the figures ignore prompt-cache discounts, so the UI can say so
   * rather than presenting an upper bound as fact.
   */
  estimatesReadHigh: true;
}

export const SPEND_WINDOW_RANGE = { min: 1, max: 90 } as const;

interface HourBucket extends RowDataPacket {
  hour_utc: string;
  purpose: string;
  model: string;
  calls: number;
  failed_calls: number;
  tokens_in: number;
  tokens_out: number;
}

/**
 * Bucketed by UTC hour in SQL and folded into business days here, rather than
 * grouped by `DATE(created_at)` directly. The pool runs `timezone: 'Z'` with the
 * session pinned to UTC while the process runs America/New_York, so a SQL date
 * would cut the day at 20:00 local and file evening calls under tomorrow. Hourly
 * buckets keep the result set small while letting the local getters below apply
 * the right offset, including across a DST change.
 */
export async function getAiSpend(windowDays: number): Promise<AiSpendRollup> {
  const days = Math.min(
    SPEND_WINDOW_RANGE.max,
    Math.max(SPEND_WINDOW_RANGE.min, Math.trunc(windowDays) || SPEND_WINDOW_RANGE.min),
  );

  const [buckets] = await pool.query<HourBucket[]>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H') AS hour_utc,
            purpose,
            model,
            COUNT(*)                                    AS calls,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed_calls,
            SUM(COALESCE(tokens_in, 0))                  AS tokens_in,
            SUM(COALESCE(tokens_out, 0))                 AS tokens_out
       FROM ai_call_logs
      WHERE created_at >= NOW() - INTERVAL ? DAY
      GROUP BY hour_utc, purpose, model`,
    [days],
  );

  const grouped = new Map<string, AiSpendRow>();
  for (const b of buckets) {
    const day = businessDay(b.hour_utc);
    if (!day) continue;
    const key = `${day}|${b.purpose}|${b.model}`;
    const row = grouped.get(key) ?? {
      day,
      purpose: b.purpose,
      model: b.model,
      calls: 0,
      failedCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      estimatedUsd: 0,
    };
    row.calls += Number(b.calls) || 0;
    row.failedCalls += Number(b.failed_calls) || 0;
    row.tokensIn += Number(b.tokens_in) || 0;
    row.tokensOut += Number(b.tokens_out) || 0;
    grouped.set(key, row);
  }

  const rows = [...grouped.values()];
  for (const row of rows) {
    // Pricing is linear in tokens, so costing the group's totals is identical to
    // summing each call — and only one model appears per group.
    row.estimatedUsd = round4(estimateUsdCost(row.model, row.tokensIn, row.tokensOut)?.usd ?? 0);
  }

  rows.sort((a, b) => (a.day === b.day ? a.purpose.localeCompare(b.purpose) : b.day.localeCompare(a.day)));

  // The exact charge is attached after the loop, so the accumulator drops it.
  const totals = new Map<string, Omit<AiSpendTotal, 'recordedUsd'>>();
  for (const row of rows) {
    const t = totals.get(row.purpose) ?? { purpose: row.purpose, calls: 0, estimatedUsd: 0 };
    t.calls += row.calls;
    t.estimatedUsd += row.estimatedUsd;
    totals.set(row.purpose, t);
  }
  const recorded = await recordedUsdByPurpose(days);
  const byPurpose = [...totals.values()]
    .map((t) => ({
      ...t,
      estimatedUsd: round4(t.estimatedUsd),
      recordedUsd: recorded.get(t.purpose) ?? null,
    }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd);

  const recordedTotals = byPurpose.filter((p) => p.recordedUsd !== null);

  return {
    windowDays: days,
    totalEstimatedUsd: round4(rows.reduce((sum, r) => sum + r.estimatedUsd, 0)),
    totalRecordedUsd: recordedTotals.length
      ? round4(recordedTotals.reduce((sum, p) => sum + (p.recordedUsd ?? 0), 0))
      : null,
    totalCalls: rows.reduce((sum, r) => sum + r.calls, 0),
    byPurpose,
    rows,
    estimatesReadHigh: true,
  };
}

/**
 * Exact spend for the jobs that bank their own cost, keyed by the same `purpose`
 * the call log uses. Summed on `started_at` (when the money was actually spent),
 * not `run_date` — a run grades the prior day, so the two differ.
 *
 * A failed lookup is not fatal: the estimate is still worth showing, so this
 * returns an empty map rather than taking the page down with it.
 */
async function recordedUsdByPurpose(days: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(usd_cost), 0) AS usd
         FROM ie_missed_opportunity_run
        WHERE started_at >= NOW() - INTERVAL ? DAY`,
      [days],
    );
    const usd = Number(rows[0]?.usd);
    if (Number.isFinite(usd)) out.set('insights.missed_opportunities', round4(usd));
  } catch {
    return out;
  }
  return out;
}

/** 'YYYY-MM-DDTHH' in UTC -> the business-timezone calendar date it belongs to. */
function businessDay(hourUtc: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hourUtc)) return null;
  const at = new Date(`${hourUtc}:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
