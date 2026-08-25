/**
 * Insights ingestion monitoring — dataset health evaluator.
 *
 * Single source of truth for "is this dataset fresh, and did the volume drop?".
 * Reads the ie_dataset_monitor registry, evaluates each dataset against two
 * signals, and upserts the latest OK/WARN/RED status into ie_dataset_health so
 * the admin dashboard reads it cheaply and alerts fire only on a status change.
 *
 * Two check strategies (registry `check_kind`):
 *   - run_recency: freshness = time since the producer's last SUCCESS run;
 *     volume  = latest SUCCESS run's rows_loaded vs a weekday-aware baseline
 *     from ie_ingestion_log. Used for snapshot feeds without a clean per-day grain.
 *   - daily_fact: freshness = latest data date present in the fact table vs the
 *     expected business date; volume = that day's row count vs a weekday-aware
 *     baseline of prior same-weekday days. Used for per-day-grained facts (this
 *     is what catches "phone/email activity then nothing" and "yesterday missing").
 *
 * Warehouse-layer service: deliberately hand-written pool SQL (per
 * backend-api-conventions), and all calendar-day math runs in the business
 * timezone via businessNow() (per the date-handling rule).
 */
import pool from '../../config/database';
import { RowDataPacket } from 'mysql2';
import logger from '../../config/logger';
import { businessNow } from '../insightsAgentActivity.service';

export type HealthStatus = 'OK' | 'WARN' | 'RED';

/** Ordering so we can take the worst of several signals. */
const RANK: Record<HealthStatus, number> = { OK: 0, WARN: 1, RED: 2 };
const worst = (a: HealthStatus, b: HealthStatus): HealthStatus => (RANK[a] >= RANK[b] ? a : b);

export interface DatasetMonitorConfig {
  datasetCode: string;
  displayName: string;
  producerKind: string;
  producerRef: string;
  checkKind: 'run_recency' | 'daily_fact';
  factTable: string | null;
  dateColumn: string | null;
  dateKind: 'date_key' | 'date' | null;
  expectedByHour: number;
  cadenceMinutes: number;
  arrearsDays: number;
  businessDaysOnly: boolean;
  baselineLookbackDays: number;
  warnPct: number;
  redPct: number;
  minExpectedRows: number;
  zeroIsRed: boolean;
}

export interface DatasetHealth {
  datasetCode: string;
  displayName: string;
  producerKind: string;
  checkKind: string;
  status: HealthStatus;
  reason: string;
  lastSuccessAt: string | null;
  expectedBy: string | null;
  lastRowCount: number | null;
  baselineCount: number | null;
}

export interface EvaluatedDataset {
  health: DatasetHealth;
  previousStatus: HealthStatus | null;
  transitioned: boolean;
}

/** Only table/column names we control are interpolated; still hard-guard them. */
const IDENT = /^[A-Za-z0-9_]+$/;
const safeIdent = (s: string): string => {
  if (!IDENT.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return s;
};

export const median = (nums: number[]): number => {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** Weekday index (0=Sun..6=Sat) of a plain 'YYYY-MM-DD' — no timezone shift. */
const weekdayOf = (isoDate: string): number => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

const addDays = (isoDate: string, delta: number): string => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
};

/** date_key int (YYYYMMDD) or a Date/'YYYY-MM-DD...' -> 'YYYY-MM-DD'. */
function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

export async function readActiveMonitors(): Promise<DatasetMonitorConfig[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT dataset_code, display_name, producer_kind, producer_ref, check_kind,
            fact_table, date_column, date_kind, expected_by_hour, cadence_minutes,
            arrears_days, business_days_only, baseline_lookback_days,
            warn_pct, red_pct, min_expected_rows, zero_is_red
     FROM ie_dataset_monitor WHERE is_active = 1 ORDER BY display_name`,
  );
  return rows.map((r) => ({
    datasetCode: String(r.dataset_code),
    displayName: String(r.display_name),
    producerKind: String(r.producer_kind),
    producerRef: String(r.producer_ref),
    checkKind: r.check_kind === 'daily_fact' ? 'daily_fact' : 'run_recency',
    factTable: (r.fact_table as string | null) ?? null,
    dateColumn: (r.date_column as string | null) ?? null,
    dateKind: (r.date_kind as 'date_key' | 'date' | null) ?? null,
    expectedByHour: Number(r.expected_by_hour),
    cadenceMinutes: Number(r.cadence_minutes),
    arrearsDays: Number(r.arrears_days),
    businessDaysOnly: !!r.business_days_only,
    baselineLookbackDays: Number(r.baseline_lookback_days),
    warnPct: Number(r.warn_pct),
    redPct: Number(r.red_pct),
    minExpectedRows: Number(r.min_expected_rows),
    zeroIsRed: !!r.zero_is_red,
  }));
}

/** The producer's most recent SUCCESS run finish time (for the "last updated" stamp). */
async function lastSuccessAt(workerName: string): Promise<Date | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT run_finished_at FROM ie_ingestion_log
     WHERE worker_name = ? AND status = 'SUCCESS' AND run_finished_at IS NOT NULL
     ORDER BY run_started_at DESC LIMIT 1`,
    [workerName],
  );
  return rows.length ? (rows[0].run_finished_at as Date) : null;
}

/** The expected data date: (today - arrears), rolled back to a business day when required. */
async function expectedDataDate(cfg: DatasetMonitorConfig, etToday: string): Promise<string> {
  const target = addDays(etToday, -cfg.arrearsDays);
  if (!cfg.businessDaysOnly) return target;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(full_date), '%Y-%m-%d') AS d
     FROM ie_dim_date WHERE is_business_day = 1 AND full_date <= ?`,
    [target],
  );
  return (rows[0]?.d as string | null) ?? target;
}

/** Shared volume classifier: latest count vs weekday baseline + floors. */
export function classifyVolume(cfg: DatasetMonitorConfig, latest: number, baseline: number): { status: HealthStatus; reason: string } {
  if (baseline <= 0) {
    if (cfg.minExpectedRows > 0 && latest < cfg.minExpectedRows) {
      return { status: 'WARN', reason: `only ${latest} rows (min expected ${cfg.minExpectedRows})` };
    }
    return { status: 'OK', reason: '' };
  }
  if (latest === 0) {
    return cfg.zeroIsRed
      ? { status: 'RED', reason: `no rows loaded (baseline ~${baseline})` }
      : { status: 'WARN', reason: `no rows loaded (baseline ~${baseline})` };
  }
  const pct = (latest / baseline) * 100;
  if (pct < cfg.redPct) return { status: 'RED', reason: `${latest} rows is ${Math.round(pct)}% of baseline ~${baseline}` };
  if (pct < cfg.warnPct) return { status: 'WARN', reason: `${latest} rows is ${Math.round(pct)}% of baseline ~${baseline}` };
  if (latest < cfg.minExpectedRows) return { status: 'WARN', reason: `only ${latest} rows (min expected ${cfg.minExpectedRows})` };
  return { status: 'OK', reason: '' };
}

/** run_recency strategy — freshness by run age, volume by rows_loaded baseline. */
async function evalRunRecency(cfg: DatasetMonitorConfig, now: Date): Promise<{ status: HealthStatus; reason: string; lastRowCount: number | null; baseline: number | null }> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT status, run_finished_at, rows_loaded, error_message
     FROM ie_ingestion_log WHERE worker_name = ?
     ORDER BY run_started_at DESC LIMIT 400`,
    [cfg.producerRef],
  );
  if (rows.length === 0) return { status: 'RED', reason: 'no runs recorded yet', lastRowCount: null, baseline: null };

  const latest = rows[0];
  if (String(latest.status) === 'FAILED') {
    return { status: 'RED', reason: `last run failed: ${String(latest.error_message ?? 'unknown').slice(0, 120)}`, lastRowCount: null, baseline: null };
  }

  const successes = rows.filter((r) => String(r.status) === 'SUCCESS' && r.run_finished_at instanceof Date);
  const lastOk = successes[0];
  const allowanceMs = Math.max(cfg.cadenceMinutes * 3, 90) * 60_000;
  if (!lastOk) return { status: 'RED', reason: 'no successful run recorded', lastRowCount: null, baseline: null };
  const ageMs = now.getTime() - (lastOk.run_finished_at as Date).getTime();
  if (ageMs > allowanceMs) {
    const hrs = Math.round(ageMs / 3_600_000);
    return { status: 'RED', reason: `stale: last success ${hrs}h ago`, lastRowCount: null, baseline: null };
  }

  // Weekday-aware volume baseline from prior successful runs (exclude the latest).
  const latestWd = latestSuccessWeekday(lastOk.run_finished_at as Date);
  const cutoff = now.getTime() - cfg.baselineLookbackDays * 86_400_000;
  const sample = successes.slice(1)
    .filter((r) => (r.run_finished_at as Date).getTime() >= cutoff && r.rows_loaded != null && latestSuccessWeekday(r.run_finished_at as Date) === latestWd)
    .map((r) => Number(r.rows_loaded))
    .slice(0, 8);
  const latestRows = lastOk.rows_loaded != null ? Number(lastOk.rows_loaded) : null;
  if (latestRows == null || sample.length < 3) return { status: 'OK', reason: '', lastRowCount: latestRows, baseline: null };
  const baseline = median(sample);
  const v = classifyVolume(cfg, latestRows, baseline);
  return { status: v.status, reason: v.reason, lastRowCount: latestRows, baseline };
}

/** ET weekday of a UTC run timestamp (freshness baseline groups by business weekday). */
function latestSuccessWeekday(finishedUtc: Date): number {
  const iso = businessNow(finishedUtc).date;
  return weekdayOf(iso);
}

/** daily_fact strategy — freshness by latest data date, volume by per-day counts. */
async function evalDailyFact(cfg: DatasetMonitorConfig, etDate: string, etHour: number): Promise<{ status: HealthStatus; reason: string; lastRowCount: number | null; baseline: number | null; expectedBy: string }> {
  const table = safeIdent(cfg.factTable ?? '');
  const col = safeIdent(cfg.dateColumn ?? '');
  const isKey = cfg.dateKind === 'date_key';
  const expected = await expectedDataDate(cfg, etDate);

  const dayExpr = isKey ? `\`${col}\`` : `DATE_FORMAT(\`${col}\`, '%Y%m%d')`;
  const lookbackKey = Number(addDays(etDate, -cfg.baselineLookbackDays).replace(/-/g, ''));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${dayExpr} AS dk, COUNT(*) AS c FROM \`${table}\`
     WHERE ${dayExpr} >= ? GROUP BY dk ORDER BY dk DESC`,
    [lookbackKey],
  );

  const perDay = rows.map((r) => ({ iso: toIsoDate(String(r.dk))!, count: Number(r.c) }));
  const maxIso = perDay[0]?.iso ?? null;

  let status: HealthStatus = 'OK';
  let reason = '';
  // Freshness: expected date missing and we're past the expected hour -> stale.
  if ((maxIso == null || maxIso < expected) && etHour >= cfg.expectedByHour) {
    status = 'RED';
    reason = `no data for ${expected} (latest ${maxIso ?? 'none'})`;
  }

  // Volume: the most recent present day vs weekday-aware baseline.
  const latestDay = perDay[0];
  const lastRowCount: number | null = latestDay ? latestDay.count : null;
  let baseline: number | null = null;
  if (latestDay) {
    const wd = weekdayOf(latestDay.iso);
    const sample = perDay.slice(1).filter((p) => weekdayOf(p.iso) === wd).map((p) => p.count).slice(0, 8);
    if (sample.length >= 3) {
      baseline = median(sample);
      const v = classifyVolume(cfg, latestDay.count, baseline);
      status = worst(status, v.status);
      if (v.status !== 'OK' && !reason) reason = v.reason;
    }
  }
  return { status, reason, lastRowCount, baseline, expectedBy: `${expected}T${String(cfg.expectedByHour).padStart(2, '0')}:00:00` };
}

/** Evaluate one dataset's current health (no writes). */
export async function evaluateDataset(cfg: DatasetMonitorConfig, now: Date = new Date()): Promise<DatasetHealth> {
  const { date: etDate, hour: etHour } = businessNow(now);
  const lastOk = await lastSuccessAt(cfg.producerRef);

  let status: HealthStatus = 'OK';
  let reason = '';
  let lastRowCount: number | null = null;
  let baseline: number | null = null;
  let expectedBy: string | null = null;

  try {
    if (cfg.checkKind === 'daily_fact' && cfg.factTable && cfg.dateColumn) {
      const r = await evalDailyFact(cfg, etDate, etHour);
      status = r.status; reason = r.reason; lastRowCount = r.lastRowCount; baseline = r.baseline; expectedBy = r.expectedBy;
    } else {
      const r = await evalRunRecency(cfg, now);
      status = r.status; reason = r.reason; lastRowCount = r.lastRowCount; baseline = r.baseline;
    }
  } catch (err) {
    logger.error('[datasetMonitor] evaluation failed', { dataset: cfg.datasetCode, error: (err as Error)?.message });
    return {
      datasetCode: cfg.datasetCode, displayName: cfg.displayName, producerKind: cfg.producerKind,
      checkKind: cfg.checkKind, status: 'WARN', reason: 'evaluation error', lastSuccessAt: lastOk?.toISOString() ?? null,
      expectedBy: null, lastRowCount: null, baselineCount: null,
    };
  }

  if (!reason && status === 'OK') reason = 'healthy';
  return {
    datasetCode: cfg.datasetCode, displayName: cfg.displayName, producerKind: cfg.producerKind,
    checkKind: cfg.checkKind, status, reason,
    lastSuccessAt: lastOk?.toISOString() ?? null, expectedBy,
    lastRowCount, baselineCount: baseline,
  };
}

/** Upsert the computed health, tracking status_since so alerts can fire on transition. */
async function persistHealth(h: DatasetHealth, now: Date): Promise<EvaluatedDataset> {
  const [prevRows] = await pool.query<RowDataPacket[]>(
    `SELECT status, status_since FROM ie_dataset_health WHERE dataset_code = ?`,
    [h.datasetCode],
  );
  const previousStatus = prevRows.length ? (String(prevRows[0].status) as HealthStatus) : null;
  const transitioned = previousStatus !== h.status;
  const statusSince = transitioned ? now : ((prevRows[0]?.status_since as Date | null) ?? now);

  await pool.query(
    `INSERT INTO ie_dataset_health
       (dataset_code, status, reason, last_success_at, expected_by, last_row_count, baseline_count, status_since, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       status = VALUES(status), reason = VALUES(reason), last_success_at = VALUES(last_success_at),
       expected_by = VALUES(expected_by), last_row_count = VALUES(last_row_count),
       baseline_count = VALUES(baseline_count), status_since = VALUES(status_since), evaluated_at = NOW()`,
    [
      h.datasetCode, h.status, h.reason.slice(0, 255),
      h.lastSuccessAt ? new Date(h.lastSuccessAt) : null,
      h.expectedBy ? new Date(h.expectedBy) : null, h.lastRowCount, h.baselineCount, statusSince,
    ],
  );
  return { health: h, previousStatus, transitioned };
}

/** Evaluate + persist every active dataset. Returns per-dataset outcomes so the
 *  worker can alert on transitions. Never throws for a single dataset. */
export async function runMonitorEvaluation(now: Date = new Date()): Promise<EvaluatedDataset[]> {
  const monitors = await readActiveMonitors();
  const out: EvaluatedDataset[] = [];
  for (const cfg of monitors) {
    try {
      const health = await evaluateDataset(cfg, now);
      out.push(await persistHealth(health, now));
    } catch (err) {
      logger.error('[datasetMonitor] persist failed', { dataset: cfg.datasetCode, error: (err as Error)?.message });
    }
  }
  return out;
}
