import pool from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';

export class BusinessCalendarSyncWorker extends BaseInsightsWorker {
  constructor() {
    super('dimension-calendar-sync', 'qtip');
  }

  protected async execute(): Promise<WorkerResult> {
    const [holidays] = await pool.execute<RowDataPacket[]>(
      `SELECT calendar_date FROM business_calendar_days WHERE day_type IN ('HOLIDAY', 'CLOSURE')`
    );

    const holidayDates = new Set(
      holidays.map((h) => {
        const d = new Date(h.calendar_date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })
    );

    let marked = 0;
    for (const dateStr of holidayDates) {
      const [result] = await pool.execute<ResultSetHeader>(
        'UPDATE ie_dim_date SET is_business_day = 0 WHERE full_date = ? AND is_business_day = 1',
        [dateStr]
      );
      marked += result.affectedRows;
    }

    const [restored] = await pool.execute<ResultSetHeader>(
      `UPDATE ie_dim_date SET is_business_day = 1
       WHERE is_business_day = 0 AND is_weekend = 0
         AND full_date NOT IN (
           SELECT calendar_date FROM business_calendar_days WHERE day_type IN ('HOLIDAY', 'CLOSURE')
         )`
    );

    return {
      rowsExtracted: holidays.length,
      rowsLoaded: marked,
      rowsSkipped: 0,
      rowsErrored: 0,
      batchIdentifier: `holidays:${holidayDates.size},restored:${restored.affectedRows}`,
    };
  }
}
