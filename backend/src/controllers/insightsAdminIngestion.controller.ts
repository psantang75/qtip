import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

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
    params.push(limit);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM ie_ingestion_log WHERE ${conditions.join(' AND ')} ORDER BY run_started_at DESC LIMIT ?`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('getIngestionLog error:', error);
    res.status(500).json({ error: 'Failed to load ingestion log' });
  }
};
