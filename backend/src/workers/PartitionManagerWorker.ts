import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';
import logger from '../config/logger';

const SERVICE = 'PartitionManagerWorker';

export class PartitionManagerWorker extends BaseInsightsWorker {
  constructor() {
    super('partition-manager', 'system');
  }

  protected async execute(): Promise<WorkerResult> {
    const config = await this.loadConfig();
    const tables = await this.findPartitionedTables();

    if (tables.length === 0) {
      logger.info('No ie_fact_* / ie_stg_* tables found; nothing to do', { service: SERVICE });
      return { rowsExtracted: 0, rowsLoaded: 0, rowsSkipped: 0, rowsErrored: 0, batchIdentifier: 'no-tables' };
    }

    let created = 0;
    let dropped = 0;

    for (const table of tables) {
      const isStaging = table.startsWith('ie_stg_');
      const existing = await this.getExistingPartitions(table);

      const futureCount = await this.createFuturePartitions(table, existing, config.lookaheadMonths);
      created += futureCount;

      if (isStaging) {
        const dropCount = await this.dropOldPartitions(table, existing, config.retentionStagingDays);
        dropped += dropCount;
      } else {
        const dropCount = await this.dropOldPartitions(table, existing, config.retentionFactYears * 365);
        dropped += dropCount;
      }
    }

    return {
      rowsExtracted: tables.length,
      rowsLoaded: created,
      rowsSkipped: 0,
      rowsErrored: 0,
      batchIdentifier: `tables:${tables.length},created:${created},dropped:${dropped}`,
    };
  }

  private async loadConfig() {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT config_key, config_value FROM ie_config
       WHERE config_key IN ('partition_lookahead_months', 'retention_staging_days', 'retention_fact_years')`
    );
    const map = new Map(rows.map((r) => [r.config_key, r.config_value]));
    return {
      lookaheadMonths: parseInt(map.get('partition_lookahead_months') ?? '3', 10),
      retentionStagingDays: parseInt(map.get('retention_staging_days') ?? '90', 10),
      retentionFactYears: parseInt(map.get('retention_fact_years') ?? '3', 10),
    };
  }

  private async findPartitionedTables(): Promise<string[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND (TABLE_NAME LIKE 'ie_fact_%' OR TABLE_NAME LIKE 'ie_stg_%')
       ORDER BY TABLE_NAME`
    );
    return rows.map((r) => r.TABLE_NAME as string);
  }

  private async getExistingPartitions(table: string): Promise<string[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT PARTITION_NAME FROM INFORMATION_SCHEMA.PARTITIONS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL
       ORDER BY PARTITION_ORDINAL_POSITION`,
      [table]
    );
    return rows.map((r) => r.PARTITION_NAME as string);
  }

  private async createFuturePartitions(table: string, existing: string[], lookaheadMonths: number): Promise<number> {
    const now = new Date();
    let created = 0;

    for (let i = 0; i <= lookaheadMonths; i++) {
      const target = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const partName = `p${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, '0')}`;

      if (existing.includes(partName) || partName === 'p_future') continue;

      const nextMonth = new Date(target.getFullYear(), target.getMonth() + 1, 1);
      const boundary = nextMonth.getFullYear() * 100 + (nextMonth.getMonth() + 1);

      try {
        await pool.execute(
          `ALTER TABLE \`${table}\` REORGANIZE PARTITION p_future INTO (
            PARTITION ${partName} VALUES LESS THAN (${boundary}),
            PARTITION p_future VALUES LESS THAN MAXVALUE
          )`
        );
        logger.info('Created partition', { service: SERVICE, partition: partName, table });
        created++;
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          logger.error('Failed to create partition', {
            service: SERVICE,
            partition: partName,
            table,
            error: err?.message,
          });
        }
      }
    }
    return created;
  }

  private async dropOldPartitions(table: string, existing: string[], maxAgeDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000);
    const cutoffYM = cutoff.getFullYear() * 100 + (cutoff.getMonth() + 1);
    let dropped = 0;

    for (const partName of existing) {
      if (partName === 'p_future') continue;
      const match = partName.match(/^p(\d{6})$/);
      if (!match) continue;

      const partYM = parseInt(match[1], 10);
      if (partYM >= cutoffYM) continue;

      try {
        await pool.execute(`ALTER TABLE \`${table}\` DROP PARTITION ${partName}`);
        logger.info('Dropped partition', { service: SERVICE, partition: partName, table });
        dropped++;
      } catch (err: any) {
        logger.error('Failed to drop partition', {
          service: SERVICE,
          partition: partName,
          table,
          error: err?.message,
        });
      }
    }
    return dropped;
  }
}
