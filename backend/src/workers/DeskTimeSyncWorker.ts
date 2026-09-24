import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';
import { deskTimeService, type DeskTimeDayRecord } from '../services/desktime/DeskTimeService';

/** One DeskTime `employees` request: a single day, or the whole month `date` falls in. */
export interface DeskTimeRequest { date: string; period: 'day' | 'month' }

const dateKeyOf = (iso: string) => Number(iso.replace(/-/g, ''));

/**
 * Month requests covering [from, to]: one per calendar month, each anchored on
 * the 1st so DeskTime returns the full month (rows outside the range are
 * filtered by the worker).
 */
export function monthRequests(from: string, to: string): DeskTimeRequest[] {
  const out: DeskTimeRequest[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-01`, period: 'month' });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Loads DeskTime employee-days into `ie_fact_desktime_daily`. Scheduled by the
 * `desktime_daily` ie_source_report row (see apiSourceReports) and run by
 * run-desktime-backfill. The upsert on (desktime_employee_id, date_key)
 * makes every run idempotent: re-syncing a day updates it in place.
 *
 * Hand-written pool SQL: this is the warehouse layer (partitioned fact), which
 * Prisma cannot model.
 */
export class DeskTimeSyncWorker extends BaseInsightsWorker {
  constructor(
    private readonly requests: DeskTimeRequest[],
    private readonly range?: { from: string; to: string },
  ) {
    super('desktime-sync', 'desktime');
  }

  protected async execute(): Promise<WorkerResult> {
    const emailToEmployeeKey = await this.loadEmployeeKeys();
    let extracted = 0;
    let loaded = 0;
    let skipped = 0;

    for (const req of this.requests) {
      const records = await deskTimeService.getEmployeeDays(req.date, req.period);
      extracted += records.length;
      const inRange = records.filter((r) => this.inRange(r.date));
      skipped += records.length - inRange.length;
      loaded += await this.upsert(inRange, emailToEmployeeKey, `${req.period}:${req.date}`);
    }

    return {
      rowsExtracted: extracted,
      rowsLoaded: loaded,
      rowsSkipped: skipped,
      rowsErrored: 0,
      batchIdentifier: this.range ? `${this.range.from}..${this.range.to}` : this.requests.map((r) => r.date).join(','),
    };
  }

  private inRange(date: string): boolean {
    return !this.range || (date >= this.range.from && date <= this.range.to);
  }

  private async loadEmployeeKeys(): Promise<Map<string, number>> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT LOWER(TRIM(email)) AS email, employee_key AS employeeKey
       FROM ie_dim_employee WHERE is_current = 1 AND email IS NOT NULL AND email <> ''`,
    );
    return new Map(rows.map((r) => [String(r.email), Number(r.employeeKey)]));
  }

  private async upsert(records: DeskTimeDayRecord[], keys: Map<string, number>, batch: string): Promise<number> {
    if (records.length === 0) return 0;
    const values = records.map((r) => [
      dateKeyOf(r.date), r.employeeId, keys.get(r.email) ?? null, r.email, r.name, r.group,
      r.arrivedAt, r.leftAt, r.isLate ? 1 : 0,
      r.onlineSec, r.desktimeSec, r.atWorkSec, r.productiveSec,
      r.productivityPct, r.efficiencyPct, batch,
    ]);
    await pool.query(
      `INSERT INTO ie_fact_desktime_daily
         (date_key, desktime_employee_id, employee_key, agent_email, agent_name, desktime_group,
          arrived_at_et, left_at_et, is_late, online_sec, desktime_sec, at_work_sec, productive_sec,
          productivity_pct, efficiency_pct, load_batch_id)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         employee_key = VALUES(employee_key), agent_email = VALUES(agent_email),
         agent_name = VALUES(agent_name), desktime_group = VALUES(desktime_group),
         arrived_at_et = VALUES(arrived_at_et), left_at_et = VALUES(left_at_et), is_late = VALUES(is_late),
         online_sec = VALUES(online_sec), desktime_sec = VALUES(desktime_sec),
         at_work_sec = VALUES(at_work_sec), productive_sec = VALUES(productive_sec),
         productivity_pct = VALUES(productivity_pct), efficiency_pct = VALUES(efficiency_pct),
         load_batch_id = VALUES(load_batch_id)`,
      [values],
    );
    return records.length;
  }
}
