/**
 * How current is the one Cycle Performance load?
 *
 * The page is five facts, but they are one job: tasks, invoices, gateway results,
 * touches, then payments. The dispatcher runs that job at :20 and :50. A member
 * with a NULL stamp is leftover from an older backfill, not proof the warehouse
 * is empty — "never run" on three rows after two just stamped is what made the
 * banner look broken.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../config/database';
import { CYCLE_LOCK_NAME } from './cyclePipeline';

/** Display order — the page's reading order, not the load order. */
export const CYCLE_DEPENDENCIES = [
  { code: 'collections_invoice', label: 'Invoices' },
  { code: 'collections_billing', label: 'Gateway Results' },
  { code: 'collections_task', label: 'AR Tasks' },
  { code: 'collections_touch', label: 'Touches' },
  { code: 'collections_recovery', label: 'Payments' },
] as const;

export interface DependencyFreshness {
  code: string;
  label: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: string | null;
  isActive: boolean;
}

export interface CycleFreshness {
  loading: boolean;
  items: DependencyFreshness[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  updateEveryMinutes: number | null;
}

function iso(value: unknown): string | null {
  return value ? new Date(value as Date | string).toISOString() : null;
}

export async function getCycleFreshness(): Promise<CycleFreshness> {
  const codes = CYCLE_DEPENDENCIES.map((d) => d.code);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT report_code, last_run_at, next_run_at, last_status, is_active, frequency_minutes
       FROM ie_source_report
      WHERE report_code IN (${codes.map(() => '?').join(',')})`,
    codes,
  );
  const [locks] = await pool.query<RowDataPacket[]>(
    `SELECT expires_at FROM ie_ingestion_lock
      WHERE worker_name = ? AND expires_at > NOW()`,
    [CYCLE_LOCK_NAME],
  );

  const byCode = new Map(rows.map((r) => [String(r.report_code), r]));
  const items = CYCLE_DEPENDENCIES.map(({ code, label }) => {
    const r = byCode.get(code);
    return {
      code,
      label,
      lastRunAt: iso(r?.last_run_at),
      nextRunAt: iso(r?.next_run_at),
      status: (r?.last_status as string | null) ?? null,
      isActive: !!r?.is_active,
    };
  });

  const stamped = items.filter((i) => i.lastRunAt).map((i) => i.lastRunAt as string);
  const upcoming = items.filter((i) => i.isActive && i.nextRunAt).map((i) => i.nextRunAt as string);
  const frequencies = rows.map((r) => Number(r.frequency_minutes)).filter((n) => n > 0);

  return {
    loading: locks.length > 0,
    items,
    lastRunAt: stamped.length ? stamped.sort().slice(-1)[0] : null,
    nextRunAt: upcoming.length ? upcoming.sort()[0] : null,
    updateEveryMinutes: frequencies.length ? Math.min(...frequencies) : null,
  };
}
