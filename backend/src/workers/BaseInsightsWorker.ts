import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import os from 'os';

export interface WorkerResult {
  rowsExtracted: number;
  rowsLoaded: number;
  rowsSkipped: number;
  rowsErrored: number;
  batchIdentifier?: string;
}

export abstract class BaseInsightsWorker {
  protected workerName: string;
  protected sourceSystem: string;

  constructor(workerName: string, sourceSystem: string) {
    this.workerName = workerName;
    this.sourceSystem = sourceSystem;
  }

  async run(): Promise<void> {
    let logId: number | null = null;

    try {
      const acquired = await this.acquireLock();
      if (!acquired) {
        console.log(`[${this.workerName}] Another instance is running. Skipping.`);
        return;
      }

      logId = await this.createLogEntry();
      console.log(`[${this.workerName}] Started (log id: ${logId})`);

      const result = await this.execute();

      await this.updateLogEntry(logId, 'SUCCESS', result);
      console.log(
        `[${this.workerName}] Completed — extracted: ${result.rowsExtracted}, ` +
        `loaded: ${result.rowsLoaded}, skipped: ${result.rowsSkipped}, errored: ${result.rowsErrored}`
      );
    } catch (error: any) {
      console.error(`[${this.workerName}] Failed:`, error.message);
      if (logId) {
        await this.updateLogEntry(logId, 'FAILED', undefined, error.message).catch(() => {});
      }
      throw error;
    } finally {
      await this.releaseLock();
    }
  }

  protected abstract execute(): Promise<WorkerResult>;

  private async acquireLock(): Promise<boolean> {
    const lockedBy = `${os.hostname()}-${process.pid}`;
    const conn = await pool.getConnection();
    try {
      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT worker_name, expires_at FROM ie_ingestion_lock WHERE worker_name = ?',
        [this.workerName]
      );

      if (existing.length > 0) {
        const expiresAt = new Date(existing[0].expires_at);
        if (expiresAt > new Date()) {
          return false;
        }
        await conn.execute('DELETE FROM ie_ingestion_lock WHERE worker_name = ?', [this.workerName]);
      }

      await conn.execute(
        'INSERT INTO ie_ingestion_lock (worker_name, locked_at, locked_by, expires_at) VALUES (?, NOW(), ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
        [this.workerName, lockedBy]
      );
      return true;
    } finally {
      conn.release();
    }
  }

  private async releaseLock(): Promise<void> {
    await pool.execute('DELETE FROM ie_ingestion_lock WHERE worker_name = ?', [this.workerName]);
  }

  private async createLogEntry(): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO ie_ingestion_log (worker_name, source_system, run_started_at, status)
       VALUES (?, ?, NOW(), 'RUNNING')`,
      [this.workerName, this.sourceSystem]
    );
    return result.insertId;
  }

  private async updateLogEntry(
    logId: number,
    status: string,
    result?: WorkerResult,
    errorMessage?: string
  ): Promise<void> {
    await pool.execute(
      `UPDATE ie_ingestion_log
       SET run_finished_at = NOW(), status = ?,
           rows_extracted = ?, rows_loaded = ?, rows_skipped = ?, rows_errored = ?,
           error_message = ?, batch_identifier = ?
       WHERE id = ?`,
      [
        status,
        result?.rowsExtracted ?? null,
        result?.rowsLoaded ?? null,
        result?.rowsSkipped ?? null,
        result?.rowsErrored ?? null,
        errorMessage ?? null,
        result?.batchIdentifier ?? null,
        logId,
      ]
    );
  }
}
