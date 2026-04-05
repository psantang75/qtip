import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';

export class RollupWorker extends BaseInsightsWorker {
  constructor() {
    super('aggregation-rollup', 'system');
  }

  protected async execute(): Promise<WorkerResult> {
    const [kpiRows] = await pool.execute<RowDataPacket[]>(
      `SELECT source_table, COUNT(*) as kpi_count
       FROM ie_kpi WHERE is_active = 1 AND source_table IS NOT NULL
       GROUP BY source_table`
    );

    if (kpiRows.length === 0) {
      console.log('[aggregation-rollup] No active KPIs to aggregate.');
      return { rowsExtracted: 0, rowsLoaded: 0, rowsSkipped: 0, rowsErrored: 0, batchIdentifier: 'no-kpis' };
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
      console.log('[aggregation-rollup] KPIs reference tables that do not exist yet. Skipping.');
      return {
        rowsExtracted: kpiRows.length,
        rowsLoaded: 0,
        rowsSkipped: kpiRows.length,
        rowsErrored: 0,
        batchIdentifier: 'no-source-tables',
      };
    }

    console.log(`[aggregation-rollup] Found ${tablesFound} source tables. Rollup logic will be added per section blueprint.`);
    return {
      rowsExtracted: kpiRows.length,
      rowsLoaded: 0,
      rowsSkipped: 0,
      rowsErrored: 0,
      batchIdentifier: `sources:${tablesFound}`,
    };
  }
}
