import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import logger from '../config/logger';
import { SourceReportSyncWorker, SourceReportConfig } from '../workers/SourceReportSyncWorker';
import { notifyIngestionFailure } from '../services/notifications/ingestionAlerts';

/**
 * Insights Admin Source Report controller — manages the scheduling fields of
 * the `ie_source_report` registry that drives automated ingestion via the
 * `SourceReportDispatcher` (`/api/insights/admin/source-reports/*`).
 *
 * Only scheduling fields are editable here (`frequency_minutes`,
 * `run_only_hours`, `is_active`) plus a "run now" that clears `next_run_at` so
 * the dispatcher picks the report up on its next tick. Structural fields
 * (report_code, SQL files, load_mode, window sizing, tables) and worker-owned
 * runtime state (last_run_at, last_status) are never written from the API —
 * cadence is intentionally data-driven and tunable without a redeploy.
 */

const RUN_ONLY_HOURS_RE = /^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/;

function mapRow(r: RowDataPacket) {
  return {
    id: Number(r.id),
    report_code: r.report_code as string,
    report_name: r.report_name as string,
    source_pool: r.source_pool as string,
    load_mode: r.load_mode as string,
    window_months: Number(r.window_months),
    incremental_days: Number(r.incremental_days),
    frequency_minutes: Number(r.frequency_minutes),
    run_only_hours: (r.run_only_hours as string | null) ?? null,
    is_active: !!r.is_active,
    target_fact_table: r.target_fact_table as string,
    last_run_at: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    next_run_at: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
    last_status: (r.last_status as string | null) ?? null,
  };
}

async function fetchById(id: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM ie_source_report WHERE id = ?',
    [id],
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/** Load the full registry row as the SourceReportSyncWorker config shape. */
async function loadConfig(id: number): Promise<SourceReportConfig | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM ie_source_report WHERE id = ?',
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    report_code: r.report_code,
    report_name: r.report_name,
    source_pool: r.source_pool,
    extract_sql_file: r.extract_sql_file,
    transform_sql_file: r.transform_sql_file ?? null,
    staging_table: r.staging_table,
    target_fact_table: r.target_fact_table,
    load_mode: r.load_mode,
    window_months: Number(r.window_months),
    incremental_days: Number(r.incremental_days),
  };
}

/** Stamp last_run_at/next_run_at/last_status after a manual run, like the dispatcher's reschedule. */
async function reschedule(id: number, status: 'SUCCESS' | 'FAILED'): Promise<void> {
  await pool.execute(
    `UPDATE ie_source_report
     SET last_run_at = NOW(),
         next_run_at = DATE_ADD(NOW(), INTERVAL frequency_minutes MINUTE),
         last_status = ?
     WHERE id = ?`,
    [status, id],
  );
}

/**
 * GET /api/insights/admin/source-reports
 */
export const listSourceReportsAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM ie_source_report ORDER BY report_name',
    );
    res.json(rows.map(mapRow));
  } catch (error) {
    logger.error('listSourceReportsAdmin error:', error);
    res.status(500).json({ error: 'Failed to list source reports' });
  }
};

/**
 * PUT /api/insights/admin/source-reports/:id
 * Updates only the scheduling fields. Partial: send any subset.
 */
export const updateSourceReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid source report id' }); return; }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (req.body.frequency_minutes !== undefined) {
      const freq = Number(req.body.frequency_minutes);
      if (!Number.isInteger(freq) || freq < 5) {
        res.status(400).json({ error: 'frequency_minutes must be an integer >= 5' });
        return;
      }
      fields.push('frequency_minutes = ?');
      values.push(freq);
    }

    if (req.body.run_only_hours !== undefined) {
      const raw = req.body.run_only_hours;
      if (raw === null || raw === '') {
        fields.push('run_only_hours = ?');
        values.push(null);
      } else if (typeof raw === 'string' && RUN_ONLY_HOURS_RE.test(raw.trim())) {
        fields.push('run_only_hours = ?');
        values.push(raw.trim().replace(/\s/g, ''));
      } else {
        res.status(400).json({ error: "run_only_hours must be blank or an hour range like '2-5' (0-23)" });
        return;
      }
    }

    if (req.body.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(req.body.is_active ? 1 : 0);
    }

    if (fields.length === 0) { res.status(400).json({ error: 'No editable fields supplied' }); return; }

    values.push(id);
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE ie_source_report SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    if (result.affectedRows === 0) { res.status(404).json({ error: 'Source report not found' }); return; }

    const updated = await fetchById(id);
    res.json(updated);
  } catch (error) {
    logger.error('updateSourceReport error:', error);
    res.status(500).json({ error: 'Failed to update source report' });
  }
};

/**
 * POST /api/insights/admin/source-reports/:id/run-now
 * Runs the ingestion immediately, in-process, using the same worker the
 * dispatcher uses (which handles its own per-report lock + run logging). The
 * run is fired asynchronously and we return 202 right away, because a full
 * reload can take a while; the report's `last_status` / `last_run_at` update
 * when it finishes (watch the Ingestion Log, or Refresh this page).
 */
export const runSourceReportNow = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid source report id' }); return; }

    const cfg = await loadConfig(id);
    if (!cfg) { res.status(404).json({ error: 'Source report not found' }); return; }

    // Push next_run_at out now so the periodic dispatcher won't also fire this
    // report while the manual run is in flight (the worker lock would make that
    // a no-op anyway, but this keeps the schedule honest).
    await pool.execute(
      'UPDATE ie_source_report SET next_run_at = DATE_ADD(NOW(), INTERVAL frequency_minutes MINUTE) WHERE id = ?',
      [id],
    );

    res.status(202).json({ started: true });

    // Run in the background — the HTTP response has already been sent.
    void (async () => {
      try {
        const result = await new SourceReportSyncWorker(cfg).run();
        // null == another run held the lock; leave its status alone.
        if (result !== null) await reschedule(id, 'SUCCESS');
      } catch (err) {
        logger.error('runSourceReportNow background run failed', { report: cfg.report_code, error: (err as Error)?.message });
        await reschedule(id, 'FAILED').catch(() => {});
        await notifyIngestionFailure({
          channel: 'sql',
          name: cfg.report_name,
          code: cfg.report_code,
          reason: (err as Error)?.message ?? 'Report run failed',
        });
      }
    })();
  } catch (error) {
    logger.error('runSourceReportNow error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to start source report run' });
  }
};
