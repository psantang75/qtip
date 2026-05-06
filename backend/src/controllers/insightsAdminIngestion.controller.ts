import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import logger from '../config/logger';

/**
 * GET /api/insights/admin/ingestion-log
 */
export const getIngestionLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const conditions: string[] = ['1=1'];
    const params: (string | number)[] = [];

    if (req.query.worker && req.query.worker !== 'all') {
      conditions.push('worker_name = ?');
      params.push(req.query.worker as string);
    }
    if (req.query.status && req.query.status !== 'all') {
      conditions.push('status = ?');
      params.push(req.query.status as string);
    }

    const limitRaw = req.query.limit;
    let limit = 200;
    if (limitRaw !== undefined && limitRaw !== '') {
      const n = parseInt(String(limitRaw), 10);
      if (!Number.isNaN(n)) {
        limit = Math.min(500, Math.max(1, n));
      }
    }

    // NOTE: `limit` is inlined (it's already clamped to 1..500 above) and we
    // use `pool.query` rather than `pool.execute` because mysql2's prepared
    // statement protocol can't bind a JS number into `LIMIT ?` on MySQL 8 —
    // the server returns ER_WRONG_ARGUMENTS (1210). The other admin/insights
    // controllers use `pool.query` for the same reason.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ie_ingestion_log WHERE ${conditions.join(' AND ')} ORDER BY run_started_at DESC LIMIT ${limit}`,
      params
    );
    res.json(rows);
  } catch (error) {
    logger.error('getIngestionLog error:', error);
    res.status(500).json({ error: 'Failed to load ingestion log' });
  }
};
