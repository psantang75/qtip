import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';
import { captureDailyTicketTotals, captureDailyTicketProductivity } from '../services/insightsAgentActivity.service';
import logger from '../config/logger';

const SERVICE = 'RollupWorker';

export class RollupWorker extends BaseInsightsWorker {
  constructor() {
    super('aggregation-rollup', 'system');
  }

  protected async execute(): Promise<WorkerResult> {
    // Tickets & Tasks daily snapshot: the first half-hourly run at/after the
    // configured hour (ie_config.ticket_daily_capture_hour, ET) persists the
    // day's per-agent bucket counts; every other run is a cheap no-op. Runs
    // before the KPI checks so an empty KPI registry can't skip it.
    const capture = await captureDailyTicketTotals();
    if (capture.captured) {
      logger.info('Captured Tickets & Tasks daily snapshot', { service: SERVICE, rows: capture.rows });
    }
    // Finalize the prior day's per-agent productivity (beginning/new/touched/
    // closed) once the morning bucket snapshot above is in place. Same
    // once-a-day gate; defensive inside so a CRM hiccup never fails the rollup.
    const prod = await captureDailyTicketProductivity();
    if (prod.captured) {
      logger.info('Captured Tickets & Tasks daily productivity', { service: SERVICE, rows: prod.rows });
    }
    const captureTag = `ticketDaily:${capture.captured ? capture.rows : capture.reason};ticketProd:${prod.captured ? prod.rows : prod.reason}`;

    const [kpiRows] = await pool.execute<RowDataPacket[]>(
      `SELECT source_table, COUNT(*) as kpi_count
       FROM ie_kpi WHERE is_active = 1 AND source_table IS NOT NULL
       GROUP BY source_table`
    );

    if (kpiRows.length === 0) {
      logger.info('No active KPIs to aggregate', { service: SERVICE });
      return { rowsExtracted: 0, rowsLoaded: capture.rows, rowsSkipped: 0, rowsErrored: 0, batchIdentifier: `no-kpis;${captureTag}` };
    }

    let tablesFound = 0;
    for (const row of kpiRows) {
      const [exists] = await pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [row.source_table]
      );
      if (exists.length > 0) tablesFound++;
    }

    if (tablesFound === 0) {
      logger.info('KPIs reference tables that do not exist yet; skipping', { service: SERVICE });
      return {
        rowsExtracted: kpiRows.length,
        rowsLoaded: capture.rows,
        rowsSkipped: kpiRows.length,
        rowsErrored: 0,
        batchIdentifier: `no-source-tables;${captureTag}`,
      };
    }

    logger.info('KPI source tables ready', { service: SERVICE, tablesFound });
    return {
      rowsExtracted: kpiRows.length,
      rowsLoaded: capture.rows,
      rowsSkipped: 0,
      rowsErrored: 0,
      batchIdentifier: `sources:${tablesFound};${captureTag}`,
    };
  }
}
